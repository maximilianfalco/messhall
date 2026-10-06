import Foundation
import Testing

@testable import Feed

@Suite("Models")
struct ModelTests {
  @Test("decode the snapshot fixture")
  func snapshot() throws {
    let snapshot = try Fixture.decode(Snapshot.self, "Snapshot")

    #expect(snapshot.seq == 7)
    #expect(snapshot.rooms.map(\.name) == ["checkout"])
    #expect(snapshot.rooms[0].members.map(\.kind) == [.claude, .human])
    #expect(snapshot.rooms[0].messages.map(\.kind) == [.system, .chat])
    #expect(snapshot.rooms[0].messages[1].mentions == ["web"])
    #expect(snapshot.rooms[0].closedAt == nil)
  }

  @Test(
    "decode each bus event fixture by its type",
    arguments: [
      ("MessageEvent", "message"), ("MemberEvent", "member"), ("PresenceEvent", "presence"), ("RoomEvent", "room"),
    ])
  func busEvent(name: String, type: String) throws {
    let event = try Fixture.decode(BusEvent.self, name)

    #expect(event.type == type)
  }

  @Test("decode the post result and the error body")
  func humanSeat() throws {
    #expect(try Fixture.decode(HumanPostResult.self, "HumanPostResult").message.from == "human")
    #expect(try Fixture.decode(FeedError.self, "FeedError").error == "room not found")
  }

  @Test("refuse a bus event with an unknown type")
  func unknownType() {
    let data = Data(#"{"type":"weather","room":"x"}"#.utf8)

    #expect(throws: DecodingError.self) { try JSONDecoder().decode(BusEvent.self, from: data) }
  }
}
