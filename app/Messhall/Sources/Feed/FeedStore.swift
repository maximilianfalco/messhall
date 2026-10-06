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

  public init() {}

  public var openRoomCount: Int { rooms.filter(\.isOpen).count }
  public var anyActive: Bool { rooms.contains { $0.members.contains { $0.presence == .active } } }

  public func room(named name: String?) -> SnapshotRoom? {
    rooms.first { $0.name == name }
  }

  func setPhase(_ phase: Phase) {
    self.phase = phase
  }

  public func apply(_ update: FeedUpdate) {
    switch update {
    case .snapshot(let snapshot):
      rooms = snapshot.rooms.sorted { $0.name < $1.name }
      seq = snapshot.seq
      loaded = true
    case .event(let seq, let event):
      apply(event)
      self.seq = max(self.seq, seq)
    }
  }

  /// Adds a message the human just posted, before its event comes back.
  func add(_ message: Message, to room: String) {
    apply(.message(MessageEvent(room: room, message: message)))
  }

  private func apply(_ event: BusEvent) {
    switch event {
    case .message(let e):
      update(e.room) { room in
        guard !room.messages.contains(where: { $0.id == e.message.id }) else { return }
        room.messages.append(e.message)
        if e.message.kind != .system { room.messageCount += 1 }
      }
    case .member(let e):
      update(e.room) { room in
        room.members.removeAll { $0.name == e.member.name }
        guard e.change != .left else { return }
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
        room.closedAt = e.room.closedAt
        room.messageCap = e.room.messageCap
      }
    }
  }

  private func update(_ name: String, _ change: (inout SnapshotRoom) -> Void) {
    guard let index = rooms.firstIndex(where: { $0.name == name }) else { return }
    change(&rooms[index])
  }
}
