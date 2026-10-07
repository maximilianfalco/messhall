import Testing

@testable import Feed

@Suite("Agents panel")
struct AgentsPanelTests {
  private func member(
    _ name: String, _ presence: Presence, kind: MemberKind = .claude, done: Bool = false, status: String? = nil
  ) -> Member {
    Member(
      roomId: "r1", name: name, kind: kind, clientLabel: nil, clientName: nil, clientVersion: nil,
      presence: presence, role: "worker", cursor: 0, done: done, joinedAt: "t0", lastSeenAt: "t0", leftAt: nil,
      status: status)
  }

  private func post(_ id: Int, from: String, _ text: String, kind: MessageKind = .chat) -> Message {
    Message(
      id: id, roomId: "r1", from: from, kind: kind, text: text, mentions: [], createdAt: "2026-01-01T09:00:00.000Z")
  }

  private func room(_ name: String, _ members: [Member], messages: [Message] = []) -> SnapshotRoom {
    SnapshotRoom(
      id: name, name: name, topic: nil, createdAt: "t0", createdBy: "human", standing: true, closedAt: nil,
      messageCount: messages.count, firstMessageId: messages.first?.id, members: members, messages: messages)
  }

  private func names(_ rows: [AgentRow]) -> [String] { rows.map(\.id) }

  @Test("active and waiting agents come first, then idle, then away, across rooms")
  func sort() {
    let panel = AgentsPanel(rooms: [
      room("api", [member("old", .away, status: "on hold"), member("web", .idle), member("ci", .waiting)]),
      room("dev", [member("qa", .active), member("docs", .invited), member("bot", .active)]),
    ])
    #expect(names(panel.shown) == ["api/ci", "dev/bot", "dev/qa", "api/web", "dev/docs", "api/old"])
  }

  @Test("the human seat and left agents never show")
  func skipsHumanAndLeft() {
    let panel = AgentsPanel(rooms: [
      room("dev", [member("human", .active, kind: .human), member("gone", .left), member("api", .idle)])
    ])
    #expect(names(panel.shown) == ["dev/api"])
    #expect(panel.folded.isEmpty)
  }

  @Test("done agents and away agents with no status fold, in room then name order")
  func fold() {
    let panel = AgentsPanel(rooms: [
      room("dev", [member("zed", .away), member("api", .active, done: true), member("web", .away, status: "paused")]),
      room("app", [member("mac", .idle, done: true)]),
    ])
    #expect(names(panel.shown) == ["dev/web"])
    #expect(names(panel.folded) == ["app/mac", "dev/api", "dev/zed"])
  }

  @Test("working counts active, waiting and idle with a status, never done or away")
  func working() {
    let panel = AgentsPanel(rooms: [
      room("dev", [
        member("a", .active), member("b", .waiting), member("c", .idle, status: "reading"), member("d", .idle),
        member("e", .away, status: "lunch"), member("f", .active, done: true), member("g", .invited, status: "x"),
      ])
    ])
    #expect(panel.working == 3)
  }

  @Test("an empty feed shows nobody and counts nobody")
  func empty() {
    let panel = AgentsPanel(rooms: [])
    #expect(panel.shown.isEmpty)
    #expect(panel.folded.isEmpty)
    #expect(panel.working == 0)
  }

  @Test("the last post is the agent's newest chat or done line, not a system line")
  func lastPost() {
    let dev = room(
      "dev", [member("api", .active), member("web", .idle)],
      messages: [
        post(1, from: "api", "first"), post(2, from: "web", "hi"), post(3, from: "api", "shipped", kind: .done),
        post(4, from: "api", "api is away", kind: .system),
      ])
    let panel = AgentsPanel(rooms: [dev])
    #expect(panel.shown.map { $0.lastPost?.id } == [3, 2])
  }

  @Test("the PR link comes from the status first, then the last post")
  func pullRequest() {
    let dev = room(
      "dev",
      [
        member("api", .active, status: "ci on https://github.com/acme/api/pull/7"),
        member("web", .active, status: "tests green"), member("ops", .active),
      ],
      messages: [
        post(1, from: "api", "see https://github.com/acme/api/pull/3"),
        post(2, from: "web", "ready https://github.com/acme/web/pull/9 and https://github.com/acme/web/pull/10"),
      ])
    let panel = AgentsPanel(rooms: [dev])
    #expect(
      panel.shown.map(\.pullRequest) == [
        PullRequestLink(owner: "acme", repo: "api", number: 7), nil,
        PullRequestLink(owner: "acme", repo: "web", number: 9),
      ])
  }
}
