import Foundation
import Testing

@testable import Feed

@MainActor
@Suite("FeedStore")
struct FeedStoreTests {
  private func loaded() throws -> FeedStore {
    let store = FeedStore()
    store.apply(.snapshot(try Fixture.decode(Snapshot.self, "Snapshot")))
    return store
  }

  private func event(_ name: String) throws -> BusEvent {
    try Fixture.decode(BusEvent.self, name)
  }

  @Test("a snapshot replaces the rooms and the sequence")
  func snapshot() throws {
    let store = try loaded()

    #expect(store.seq == 7)
    #expect(store.rooms.map(\.name) == ["checkout"])
    #expect(store.openRoomCount == 1)
    #expect(store.anyActive)
  }

  @Test("a message event appends once, counts as a post and moves the sequence")
  func message() throws {
    let store = try loaded()

    store.apply(.event(seq: 8, try event("MessageEvent")))
    store.apply(.event(seq: 9, try event("MessageEvent")))

    #expect(store.rooms[0].messages.map(\.id) == [1, 2, 3])
    #expect(store.rooms[0].messageCount == 2)
    #expect(store.seq == 9)
  }

  @Test("a system message or a summary does not count as a post", arguments: [MessageKind.system, .summary])
  func daemonMessage(kind: MessageKind) throws {
    let store = try loaded()
    let line = Message(
      id: 9, roomId: "r1", from: "messhall", kind: kind, text: "web left", mentions: [],
      createdAt: "2026-01-01T09:03:00.000Z")

    store.apply(.event(seq: 8, .message(MessageEvent(room: "checkout", message: line))))

    #expect(store.rooms[0].messageCount == 1)
  }

  @Test("a member event adds a joiner and keeps a leaver as left")
  func member() throws {
    let store = try loaded()
    let joined = try event("MemberEvent")
    guard case .member(let payload) = joined else { Issue.record("not a member event"); return }

    store.apply(.event(seq: 8, joined))
    var left = payload.member
    left.presence = .left
    store.apply(.event(seq: 9, .member(MemberEvent(room: "checkout", change: .left, member: left))))
    #expect(store.rooms[0].members.map(\.name) == ["api", "human", "web"])
    #expect(store.rooms[0].members[2].presence == .left)
    store.apply(.event(seq: 10, joined))
    #expect(store.rooms[0].members.map(\.name) == ["api", "human", "web"])
    #expect(store.rooms[0].members[2].presence == .waiting)
  }

  @Test("a role event updates the member and adds no line")
  func role() throws {
    let store = try loaded()
    let json = try Fixture.text("MemberEvent")
      .replacingOccurrences(of: #""change": "joined""#, with: #""change": "role""#)
      .replacingOccurrences(of: #""role": "unassigned""#, with: #""role": "reviewer""#)
    store.apply(.event(seq: 8, try event("MemberEvent")))

    store.apply(.event(seq: 9, try JSONDecoder().decode(BusEvent.self, from: Data(json.utf8))))

    #expect(store.rooms[0].members.map(\.name) == ["api", "human", "web"])
    #expect(store.rooms[0].members.map(\.role) == ["reviewer", "unassigned", "reviewer"])
    #expect(store.rooms[0].messages.map(\.id) == [1, 2])
  }

  @Test("a presence event changes one member")
  func presence() throws {
    let store = try loaded()

    store.apply(.event(seq: 8, try event("PresenceEvent")))

    #expect(store.rooms[0].members.map(\.presence) == [.idle, .idle])
    #expect(!store.anyActive)
  }

  @Test("a room event updates a known room and adds a new one")
  func room() throws {
    let store = try loaded()
    let closed = try event("RoomEvent")
    guard case .room(let payload) = closed else { Issue.record("not a room event"); return }
    var fresh = payload.room
    fresh.name = "billing"
    fresh.id = "r2"
    fresh.closedAt = nil

    store.apply(.event(seq: 8, closed))
    store.apply(.event(seq: 9, .room(RoomEvent(change: .created, room: fresh))))

    #expect(store.rooms.map(\.name) == ["billing", "checkout"])
    #expect(store.rooms[1].closedAt == "2026-01-01T09:05:00.000Z")
    #expect(store.rooms[1].messages.count == 2)
    #expect(store.rooms[0].members == [])
    #expect(store.openRoomCount == 1)
  }

  @Test("a created event adds a standing room with who made it")
  func created() throws {
    let store = try loaded()

    store.apply(.event(seq: 8, .room(RoomEvent(change: .created, room: humanRoom(closedAt: nil)))))

    let room = try #require(store.room(named: "ops"))
    #expect(room.standing)
    #expect(room.createdBy == "human")
    #expect(room.isOpen)
    #expect(store.openRoomCount == 2)
  }

  @Test("closed then reopened keeps the transcript and flips the room back open")
  func closedReopened() throws {
    let store = try loaded()

    store.apply(.event(seq: 8, .room(RoomEvent(change: .closed, room: checkout(closedAt: "2026-01-01T09:05:00.000Z")))))
    #expect(store.room(named: "checkout")?.isOpen == false)
    #expect(store.openRoomCount == 0)

    store.apply(.event(seq: 9, .room(RoomEvent(change: .reopened, room: checkout(closedAt: nil)))))
    #expect(store.room(named: "checkout")?.isOpen == true)
    #expect(store.room(named: "checkout")?.messages.count == 2)
    #expect(store.room(named: "checkout")?.members.count == 2)
  }

  @Test("a room event carries a changed standing flag and maker onto a known room")
  func standingChange() throws {
    let store = try loaded()
    var room = checkout(closedAt: nil)
    room.standing = true
    room.createdBy = "human"

    store.apply(.event(seq: 8, .room(RoomEvent(change: .topic, room: room))))

    #expect(store.room(named: "checkout")?.standing == true)
    #expect(store.room(named: "checkout")?.createdBy == "human")
  }

  @Test("a room the human just made shows at once and is not doubled by its event")
  func addedRoom() throws {
    let store = try loaded()

    store.add(humanRoom(closedAt: nil))
    store.apply(.event(seq: 8, .room(RoomEvent(change: .created, room: humanRoom(closedAt: nil)))))

    #expect(store.rooms.map(\.name) == ["checkout", "ops"])
  }

  private func humanRoom(closedAt: String?) -> Room {
    Room(
      id: "r9", name: "ops", topic: nil, createdAt: "2026-01-01T10:00:00.000Z", createdBy: "human", standing: true,
      closedAt: closedAt)
  }

  private func checkout(closedAt: String?) -> Room {
    Room(
      id: "r1", name: "checkout", topic: "order schema change", createdAt: "2026-01-01T09:00:00.000Z",
      createdBy: "api", standing: false, closedAt: closedAt)
  }

  @Test("a snapshot after a drop clears the down phase")
  func snapshotClearsDown() throws {
    let store = try loaded()
    store.setPhase(.down("Messhall is not running."))

    store.apply(.snapshot(try Fixture.decode(Snapshot.self, "Snapshot")))

    #expect(store.phase == .live)
  }

  @Test("an event after a drop clears the down phase")
  func eventClearsDown() throws {
    let store = try loaded()
    store.setPhase(.down("Messhall is not running."))

    store.apply(.event(seq: 8, try event("PresenceEvent")))

    #expect(store.phase == .live)
  }

  @Test("an event for an unknown room is ignored")
  func unknownRoom() throws {
    let store = try loaded()

    store.apply(.event(seq: 8, .presence(PresenceEvent(room: "nope", name: "api", from: .active, to: .gone))))

    #expect(store.rooms[0].members[0].presence == .active)
    #expect(store.seq == 8)
  }

  @Test("an SSE frame decodes into an update")
  func decodeFrame() throws {
    let update = try FeedUpdate.decode(
      .event(id: "8", name: "presence", data: try Fixture.text("PresenceEvent")))
    let snapshot = try FeedUpdate.decode(.event(id: "7", name: "snapshot", data: try Fixture.text("Snapshot")))

    #expect(update == .event(seq: 8, try event("PresenceEvent")))
    #expect(snapshot == .snapshot(try Fixture.decode(Snapshot.self, "Snapshot")))
    #expect(try FeedUpdate.decode(.ping) == nil)
  }

  @Test("onEvent sees each feed event with the room as it was before, and never a snapshot or a local post")
  func onEvent() throws {
    let store = try loaded()
    var seen: [(BusEvent, Int?)] = []
    store.onEvent = { event, room in seen.append((event, room?.messages.count)) }
    let message = try event("MessageEvent")

    store.apply(.event(seq: 8, message))
    store.add(
      Message(
        id: 20, roomId: "r1", from: "human", kind: .chat, text: "hi", mentions: [],
        createdAt: "2026-01-01T09:04:00.000Z"), to: "checkout")
    store.apply(.snapshot(try Fixture.decode(Snapshot.self, "Snapshot")))

    #expect(seen.map(\.0) == [message])
    #expect(seen.map(\.1) == [2])
  }
}
