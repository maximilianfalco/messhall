import Foundation
import Observation

/// All feed state the views read. Only the main actor changes it.
@MainActor
@Observable
public final class FeedStore {
  public enum Phase: Equatable, Sendable {
    case connecting
    case live
    case down(String)
  }

  public private(set) var rooms: [SnapshotRoom] = []
  public private(set) var seq = 0
  public private(set) var phase = Phase.connecting
  public private(set) var loaded = false
  /// Rooms with an older page on its way.
  public private(set) var loadingOlder: Set<String> = []
  /// When the current stream opened. Events stamped before it are a replay.
  @ObservationIgnored public internal(set) var liveSince = Date.distantFuture
  /// Called for each feed event, before it applies, with the room as it was.
  @ObservationIgnored public var onEvent: (@MainActor (BusEvent, SnapshotRoom?) -> Void)?

  public init() {}

  public var openRoomCount: Int { rooms.filter(\.isOpen).count }
  public var anyActive: Bool { rooms.contains { $0.members.contains { $0.presence == .active } } }

  public func room(named name: String?) -> SnapshotRoom? {
    rooms.first { $0.name == name }
  }

  func setPhase(_ phase: Phase) {
    self.phase = phase
  }

  /// Applies a snapshot or an event. Either one proves the daemon answers, so it also ends a down phase.
  public func apply(_ update: FeedUpdate) {
    phase = .live
    switch update {
    case .snapshot(let snapshot):
      rooms = snapshot.rooms.map(keepingOlderPages).sorted { $0.name < $1.name }
      loadingOlder = []
      seq = snapshot.seq
      loaded = true
    case .event(let seq, let event):
      onEvent?(event, room(named: event.room))
      apply(event)
      self.seq = max(self.seq, seq)
    }
  }

  /// Marks the room as loading and returns the id to page below, or nil when it has nothing older or is loading.
  func beginLoadingOlder(_ name: String) -> Int? {
    guard let room = room(named: name), room.hasMore, !loadingOlder.contains(name) else { return nil }
    loadingOlder.insert(name)
    return room.oldestLoadedId
  }

  func endLoadingOlder(_ name: String) {
    loadingOlder.remove(name)
  }

  /// Puts an older page above the loaded lines. An empty page means the top is reached.
  func prepend(_ older: [Message], to name: String) {
    loadingOlder.remove(name)
    update(name) { room in
      let oldest = room.oldestLoadedId ?? Int.max
      let page = older.filter { $0.id < oldest }
      if page.isEmpty { room.firstMessageId = room.oldestLoadedId }
      room.messages = page + room.messages
    }
  }

  /// A reloaded snapshot keeps the older pages already shown, but only when they join up with it with no gap.
  private func keepingOlderPages(_ fresh: SnapshotRoom) -> SnapshotRoom {
    guard let first = fresh.oldestLoadedId, let shown = room(named: fresh.name),
      shown.messages.contains(where: { $0.id == first })
    else { return fresh }
    var room = fresh
    room.messages = shown.messages.filter { $0.id < first } + fresh.messages
    return room
  }

  /// Adds a message the human just posted, before its event comes back.
  func add(_ message: Message, to room: String) {
    apply(.message(MessageEvent(room: room, message: message)))
  }

  /// Shows a room the human just made, closed or reopened, before its event comes back.
  func add(_ room: Room) {
    apply(.room(RoomEvent(change: .topic, room: room)))
  }

  private func apply(_ event: BusEvent) {
    switch event {
    case .message(let e):
      update(e.room) { room in
        guard !room.messages.contains(where: { $0.id == e.message.id }) else { return }
        room.messages.append(e.message)
        if e.message.kind == .chat || e.message.kind == .done { room.messageCount += 1 }
      }
    case .member(let e):
      update(e.room) { room in
        room.members.removeAll { $0.name == e.member.name }
        room.members.append(e.member)
        room.members.sort { $0.name < $1.name }
      }
    case .presence(let e):
      update(e.room) { room in
        guard let index = room.members.firstIndex(where: { $0.name == e.name }) else { return }
        room.members[index].presence = e.to
      }
    case .room(let e):
      guard rooms.contains(where: { $0.name == e.room.name }) else {
        rooms.append(SnapshotRoom(room: e.room))
        rooms.sort { $0.name < $1.name }
        return
      }
      update(e.room.name) { room in
        room.topic = e.room.topic
        room.createdBy = e.room.createdBy
        room.standing = e.room.standing
        room.closedAt = e.room.closedAt
      }
    }
  }

  private func update(_ name: String, _ change: (inout SnapshotRoom) -> Void) {
    guard let index = rooms.firstIndex(where: { $0.name == name }) else { return }
    change(&rooms[index])
  }
}
