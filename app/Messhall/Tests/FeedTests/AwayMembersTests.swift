import Testing

@testable import Feed

@Suite("Away members")
struct AwayMembersTests {
  private func member(_ name: String, _ presence: Presence, kind: MemberKind = .claude) -> Member {
    Member(
      roomId: "r1", name: name, kind: kind, clientLabel: nil, clientName: nil, clientVersion: nil,
      presence: presence, role: "unassigned", cursor: 0, done: false, joinedAt: "t0", lastSeenAt: "t0", leftAt: nil)
  }

  private func room(_ members: [Member]) -> SnapshotRoom {
    SnapshotRoom(
      id: "r1", name: "dev", topic: nil, createdAt: "t0", createdBy: "human", standing: true, closedAt: nil,
      messageCap: 200, messageCount: 0, firstMessageId: nil, members: members, messages: [])
  }

  @Test("live agents come first, then the human, and gone or left agents stay off")
  func live() {
    let dev = room([
      member("human", .active, kind: .human), member("api", .active), member("old", .gone),
      member("web", .idle), member("ci", .left), member("qa", .waiting),
    ])
    #expect(dev.liveMembers.map(\.name) == ["api", "web", "qa", "human"])
  }

  @Test("gone and left agents fold together, in room order")
  func away() {
    let dev = room([
      member("api", .active), member("old", .gone), member("ci", .left), member("human", .active, kind: .human),
      member("bot", .gone),
    ])
    #expect(dev.awayMembers.map(\.name) == ["old", "ci", "bot"])
  }

  @Test("the human seat is never folded away")
  func humanStays() {
    let dev = room([member("api", .gone), member("human", .gone, kind: .human)])
    #expect(dev.liveMembers.map(\.name) == ["human"])
    #expect(dev.awayMembers.map(\.name) == ["api"])
  }

  @Test("the agent count skips gone and left agents")
  func liveAgents() {
    let dev = room([
      member("api", .active), member("old", .gone), member("ci", .left), member("human", .active, kind: .human),
    ])
    #expect(dev.liveAgents.map(\.name) == ["api"])
  }
}
