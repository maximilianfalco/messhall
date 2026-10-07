import Testing

@testable import Feed

@Suite("Sidebar")
struct SidebarTests {
  private func member(_ name: String, _ presence: Presence, kind: MemberKind = .claude) -> Member {
    Member(
      roomId: "r1", name: name, kind: kind, clientLabel: nil, clientName: nil, clientVersion: nil,
      presence: presence, role: "unassigned", cursor: 0, done: false, joinedAt: "t0", lastSeenAt: "t0", leftAt: nil)
  }

  private func room(_ members: [Member]) -> SnapshotRoom {
    SnapshotRoom(
      id: "r1", name: "dev", topic: nil, createdAt: "t0", createdBy: "human", standing: true, closedAt: nil,
      messageCount: 0, firstMessageId: nil, members: members, messages: [])
  }

  private func line(_ id: Int, kind: MessageKind) -> Message {
    Message(
      id: id, roomId: "r1", from: kind == .system ? "messhall" : "api", kind: kind, text: "x", mentions: [],
      createdAt: "2026-01-01T09:00:00.000Z")
  }

  @Test("a room with live agents shows how many, away and left agents and the human do not count")
  func agentCount() {
    let dev = room([
      member("human", .active, kind: .human), member("api", .active), member("web", .idle), member("old", .away),
      member("ci", .left),
    ])
    #expect(dev.sidebarAgentCount == 2)
  }

  @Test("a room with no live agent shows no count at all")
  func noAgents() {
    #expect(room([member("human", .active, kind: .human), member("old", .away)]).sidebarAgentCount == nil)
  }

  @Test("unread counts the chat and done lines after the last one seen, never system lines or summaries")
  func unread() {
    let lines = [
      line(1, kind: .chat), line(2, kind: .chat), line(3, kind: .system), line(4, kind: .done),
      line(5, kind: .summary), line(6, kind: .chat),
    ]
    #expect(unreadCount(messages: lines, seenId: 1) == 3)
    #expect(unreadCount(messages: lines, seenId: 6) == 0)
  }
}
