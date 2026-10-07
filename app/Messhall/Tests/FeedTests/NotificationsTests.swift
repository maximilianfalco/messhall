import Foundation
import Testing

@testable import Feed

@Suite("notificationFor")
struct NotificationsTests {
  private static let liveSince = "2026-01-01T09:02:00.000Z"
  private static let after = "2026-01-01T09:03:00.000Z"
  private static let before = "2026-01-01T09:01:00.000Z"

  private func room() throws -> SnapshotRoom {
    try #require(try Fixture.decode(Snapshot.self, "Snapshot").rooms.first)
  }

  private func state(room: SnapshotRoom?, muted: Set<String> = [], enabled: Bool = true) throws -> NotifyState {
    NotifyState(
      room: room, mutedRooms: muted, enabled: enabled, liveSince: try #require(parseStamp(Self.liveSince)))
  }

  private func message(
    from: String = "api", kind: MessageKind = .chat, text: String, mentions: [String] = [], at: String = after
  ) -> BusEvent {
    .message(
      MessageEvent(
        room: "checkout",
        message: Message(
          id: 9, roomId: "r1", from: from, kind: kind, text: text, mentions: mentions, createdAt: at)))
  }

  private func closed(at: String = after) -> BusEvent {
    .room(
      RoomEvent(
        change: .closed,
        room: Room(
          id: "r1", name: "checkout", topic: nil, createdAt: Self.before, createdBy: "api", standing: false,
          closedAt: at)))
  }

  private func joined(_ name: String, to room: SnapshotRoom) throws -> SnapshotRoom {
    var room = room
    var member = try #require(room.members.first)
    member.name = name
    room.members.append(member)
    return room
  }

  @Test("a mention of human posts the room as title and sender and text as body")
  func mentionHuman() throws {
    let event = message(text: "@human can you approve the schema", mentions: ["human"])

    #expect(
      notificationFor(event: event, state: try state(room: room()))
        == NotificationContent(room: "checkout", title: "#checkout", body: "api: @human can you approve the schema"))
  }

  @Test("a mention of all posts")
  func mentionAll() throws {
    let room = try joined("web", to: room())
    let event = message(text: "@all heads up, the api is down", mentions: ["all"])

    #expect(notificationFor(event: event, state: try state(room: room))?.body == "api: @all heads up, the api is down")
  }

  @Test("a question from the only agent in the room posts")
  func loneQuestion() throws {
    let event = message(text: "should the amount be in minor units?  ")

    #expect(notificationFor(event: event, state: try state(room: room()))?.title == "#checkout")
  }

  @Test("a question in a room with two agents does not post")
  func questionWithPeer() throws {
    let room = try joined("web", to: room())

    #expect(notificationFor(event: message(text: "ready?"), state: try state(room: room)) == nil)
  }

  @Test("a question after the other agent left posts")
  func questionAfterPeerLeft() throws {
    var room = try joined("web", to: room())
    room.members[room.members.count - 1].leftAt = Self.before

    #expect(notificationFor(event: message(text: "anyone?"), state: try state(room: room)) != nil)
  }

  @Test("a chat line with no question and no mention does not post")
  func plainChat() throws {
    #expect(notificationFor(event: message(text: "pushed the fix"), state: try state(room: room())) == nil)
  }

  @Test("a mention of another agent only does not post")
  func agentOnlyMention() throws {
    let room = try joined("web", to: room())
    let event = message(text: "@web the schema changed", mentions: ["web"])

    #expect(notificationFor(event: event, state: try state(room: room)) == nil)
  }

  @Test("the human's own post does not post, even with a mention of all")
  func ownPost() throws {
    let event = message(from: "human", text: "@all wrap up?", mentions: ["all"])

    #expect(notificationFor(event: event, state: try state(room: room())) == nil)
  }

  @Test("an event stamped before the stream went live does not post")
  func replay() throws {
    let event = message(text: "@human ping", mentions: ["human"], at: Self.before)

    #expect(notificationFor(event: event, state: try state(room: room())) == nil)
    #expect(notificationFor(event: closed(at: Self.before), state: try state(room: room())) == nil)
  }

  @Test("a muted room does not post")
  func mutedRoom() throws {
    let event = message(text: "@human ping", mentions: ["human"])

    #expect(notificationFor(event: event, state: try state(room: room(), muted: ["checkout"])) == nil)
  }

  @Test("notifications turned off do not post")
  func disabled() throws {
    let event = message(text: "@human ping", mentions: ["human"])

    #expect(notificationFor(event: event, state: try state(room: room(), enabled: false)) == nil)
  }

  @Test("a closed room posts the closing line")
  func roomClosed() throws {
    var room = try room()
    room.messages.append(
      Message(
        id: 9, roomId: "r1", from: "messhall", kind: .system, text: "all done, room closed", mentions: [],
        createdAt: Self.after))

    #expect(
      notificationFor(event: closed(), state: try state(room: room))
        == NotificationContent(room: "checkout", title: "#checkout", body: "messhall: all done, room closed"))
  }

  @Test("a room the human closed does not post")
  func humanClosed() throws {
    var room = try room()
    room.messages.append(
      Message(
        id: 9, roomId: "r1", from: "messhall", kind: .system, text: "#checkout closed by the human", mentions: [],
        createdAt: Self.after))

    #expect(notificationFor(event: closed(), state: try state(room: room)) == nil)
  }

  @Test("other room changes do not post")
  func roomReopened() throws {
    guard case .room(var payload) = closed() else { Issue.record("not a room event"); return }
    payload.change = .reopened

    #expect(notificationFor(event: .room(payload), state: try state(room: room())) == nil)
  }

  @Test("system lines do not post, an old wrap up line included", arguments: ["web left", "#checkout is at 160/200, wrap up"])
  func systemLine(text: String) throws {
    let event = message(from: "messhall", kind: .system, text: text)

    #expect(notificationFor(event: event, state: try state(room: room())) == nil)
  }

  @Test("member and presence events do not post")
  func memberAndPresence() throws {
    let room = try room()
    let presence = BusEvent.presence(PresenceEvent(room: "checkout", name: "api", from: .active, to: .idle))
    let member = BusEvent.member(MemberEvent(room: "checkout", change: .joined, member: room.members[0]))

    #expect(notificationFor(event: presence, state: try state(room: room)) == nil)
    #expect(notificationFor(event: member, state: try state(room: room)) == nil)
  }

  private func ask(state: ApprovalState = .pending, at: String = after) -> BusEvent {
    .approval(
      ApprovalEvent(
        room: "checkout",
        approval: Approval(
          id: "a1", room: "checkout", member: "api", tool: "Bash", description: "Run the tests",
          inputPreview: "{\"command\": \"pnpm test\"}", state: state, createdAt: at, answeredAt: nil)))
  }

  @Test("a new tool ask posts who asks and what it runs")
  func toolAsk() throws {
    #expect(
      notificationFor(event: ask(), state: try state(room: room()))
        == NotificationContent(room: "checkout", title: "#checkout", body: "api asks to use Bash: Run the tests"))
  }

  @Test("an answered ask, a replayed ask or one in a muted room does not post")
  func quietAsks() throws {
    let room = try room()

    #expect(notificationFor(event: ask(state: .allowed), state: try state(room: room)) == nil)
    #expect(notificationFor(event: ask(at: Self.before), state: try state(room: room)) == nil)
    #expect(notificationFor(event: ask(), state: try state(room: room, muted: ["checkout"])) == nil)
  }

  private func question(state: QuestionState = .open, at: String = after) -> BusEvent {
    .question(
      QuestionEvent(
        room: "checkout",
        question: Question(
          id: "q1", room: "checkout", member: "api", messageId: 9, question: "Which suite first?",
          options: ["Unit", "Integration"], state: state, answer: nil, createdAt: at, answeredAt: nil)))
  }

  @Test("a new question posts who asks, the question and its options as actions")
  func newQuestion() throws {
    #expect(
      notificationFor(event: question(), state: try state(room: room()))
        == NotificationContent(
          room: "checkout", title: "#checkout", body: "api asks you: Which suite first?", questionId: "q1",
          options: ["Unit", "Integration"]))
  }

  @Test("a closed question, a replayed one or one in a muted room does not post")
  func quietQuestions() throws {
    let room = try room()

    #expect(notificationFor(event: question(state: .answered), state: try state(room: room)) == nil)
    #expect(notificationFor(event: question(at: Self.before), state: try state(room: room)) == nil)
    #expect(notificationFor(event: question(), state: try state(room: room, muted: ["checkout"])) == nil)
  }

  @Test("a question that is no longer open clears its banner", arguments: [
    QuestionState.answered, .expired, .replaced,
  ])
  func clearBanner(state: QuestionState) {
    #expect(bannerToClear(for: question(state: state)) == "q1")
  }

  @Test("an open question or any other event clears no banner")
  func keepBanner() throws {
    #expect(bannerToClear(for: question()) == nil)
    #expect(bannerToClear(for: message(text: "hi")) == nil)
  }

  @Test("each option maps to an action and back to its index")
  func optionActions() {
    #expect(questionCategory("q1") == "question.q1")
    #expect((0..<4).map(optionAction).compactMap(optionIndex(of:)) == [0, 1, 2, 3])
    #expect(optionIndex(of: "com.apple.UNNotificationDefaultActionIdentifier") == nil)
    #expect(optionIndex(of: "option.x") == nil)
  }

  @Test("a body past 120 characters is cut with an ellipsis")
  func cutBody() throws {
    let text = "@human " + String(repeating: "a", count: 200)
    let body = try #require(
      notificationFor(event: message(text: text, mentions: ["human"]), state: try state(room: room()))?.body)

    #expect(body.count == 120)
    #expect(body.hasPrefix("api: @human aaa"))
    #expect(body.hasSuffix("a…"))
  }

  @Test("a body of exactly 120 characters is kept whole")
  func bodyAtLimit() throws {
    let text = "@human " + String(repeating: "b", count: 108)
    let body = notificationFor(event: message(text: text, mentions: ["human"]), state: try state(room: room()))?.body

    #expect(body == "api: " + text)
    #expect(body?.count == 120)
  }
}
