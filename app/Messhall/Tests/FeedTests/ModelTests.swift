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
      ("ApprovalEvent", "approval"), ("QuestionEvent", "question"),
    ])
  func busEvent(name: String, type: String) throws {
    let event = try Fixture.decode(BusEvent.self, name)

    #expect(event.type == type)
  }

  @Test("decode a member who left with presence left")
  func memberLeft() throws {
    let member = try Fixture.decode(Member.self, "Member")

    #expect(member.presence == .left)
    #expect(member.leftAt != nil)
    #expect(member.role == "reviewer")
  }

  @Test("decode the post result and the error body")
  func humanSeat() throws {
    #expect(try Fixture.decode(HumanPostResult.self, "HumanPostResult").message.from == "human")
    #expect(try Fixture.decode(FeedError.self, "FeedError").error == "room not found")
  }

  @Test("decode a question's options in order and a state the app does not know as unknown")
  func question() throws {
    let json = try Fixture.text("QuestionEvent")
      .replacingOccurrences(of: #""state": "open""#, with: #""state": "snoozed""#)

    guard case .question(let e) = try JSONDecoder().decode(BusEvent.self, from: Data(json.utf8)) else {
      Issue.record("not a question event"); return
    }
    #expect(e.question.options == ["Unit", "Integration", "Both"])
    #expect(e.question.messageId == 2)
    #expect(e.question.state == .unknown)
    #expect(e.question.answer == nil)
  }

  @Test("decode the answer result with the picked option and the human's line")
  func answerResult() throws {
    let result = try Fixture.decode(AnswerResult.self, "AnswerResult")

    #expect(result.question.state == .answered)
    #expect(result.question.answer == 0)
    #expect(result.message.from == "human")
  }

  @Test("decode a bus event with an unknown type as unknown")
  func unknownType() throws {
    let data = Data(#"{"type":"weather","room":"x"}"#.utf8)

    #expect(try JSONDecoder().decode(BusEvent.self, from: data) == .unknown(type: "weather"))
  }

  @Test("decode a presence the app does not know as unknown")
  func unknownPresence() throws {
    let data = Data(#"{"type":"presence","room":"checkout","name":"api","from":"active","to":"dozing"}"#.utf8)

    #expect(try JSONDecoder().decode(BusEvent.self, from: data) == .presence(
      PresenceEvent(room: "checkout", name: "api", from: .active, to: .unknown)))
  }

  @Test("decode a member change and a member kind the app does not know as unknown")
  func unknownMemberChange() throws {
    var json = try Fixture.text("MemberEvent")
    json = json.replacingOccurrences(of: #""change": "joined""#, with: #""change": "benched""#)
    json = json.replacingOccurrences(of: #""kind": "codex""#, with: #""kind": "gemini""#)

    let event = try JSONDecoder().decode(BusEvent.self, from: Data(json.utf8))

    guard case .member(let e) = event else { Issue.record("not a member event"); return }
    #expect(e.change == .unknown)
    #expect(e.member.kind == .unknown)
  }

  @Test("decode a room change the app does not know as unknown")
  func unknownRoomChange() throws {
    let json = try Fixture.text("RoomEvent").replacingOccurrences(of: #""change": "closed""#, with: #""change": "archived""#)

    guard case .room(let e) = try JSONDecoder().decode(BusEvent.self, from: Data(json.utf8)) else {
      Issue.record("not a room event"); return
    }
    #expect(e.change == .unknown)
  }

  @Test("decode a message kind the app does not know as unknown")
  func unknownMessageKind() throws {
    let json = try Fixture.text("MessageEvent").replacingOccurrences(of: #""kind": "done""#, with: #""kind": "poll""#)

    guard case .message(let e) = try JSONDecoder().decode(BusEvent.self, from: Data(json.utf8)) else {
      Issue.record("not a message event"); return
    }
    #expect(e.message.kind == .unknown)
  }
}
