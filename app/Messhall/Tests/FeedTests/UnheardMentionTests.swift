import Testing

@testable import Feed

@Suite("Unheard mentions")
struct UnheardMentionTests {
  private func member(reach: Reach?, presence: Presence = .active, cursor: Int = 0) -> Member {
    var member = MemberTypeTests.member(name: "web", kind: .claude, client: nil, version: nil, label: nil)
    member.reach = reach
    member.presence = presence
    member.cursor = cursor
    return member
  }

  private func message(_ id: Int, mentions: [String], from: String = "api", kind: MessageKind = .chat) -> Message {
    Message(
      id: id, roomId: "r1", from: from, kind: kind, text: "hi", mentions: mentions, createdAt: "t0")
  }

  @Test("a no doorbell agent that is not waiting cant hear an unread mention")
  func unheard() {
    #expect(member(reach: .noDoorbell).cantHear(message(5, mentions: ["web"])))
    #expect(member(reach: .noDoorbell, presence: .idle).cantHear(message(5, mentions: ["all"])))
  }

  @Test("a waiting agent hears it", arguments: [Reach.noDoorbell])
  func waiting(reach: Reach) {
    #expect(!member(reach: reach, presence: .waiting).cantHear(message(5, mentions: ["web"])))
  }

  @Test("a doorbell, spawned or unknown agent is never flagged")
  func otherReach() {
    for reach: Reach? in [.doorbell, .spawned, .unknown, nil] {
      #expect(!member(reach: reach).cantHear(message(5, mentions: ["web"])))
    }
  }

  @Test("a read mention, someone elses mention and its own post are not flagged")
  func notUnread() {
    let seat = member(reach: .noDoorbell, cursor: 5)
    #expect(!seat.cantHear(message(5, mentions: ["web"])))
    #expect(!seat.cantHear(message(6, mentions: ["db"])))
    #expect(!seat.cantHear(message(6, mentions: ["web"], from: "web")))
    #expect(!seat.cantHear(message(6, mentions: ["web"], kind: .system)))
  }

  @Test("the agent row flags the newest unread mention for the panel")
  func rowFlag() {
    let seat = member(reach: .noDoorbell, presence: .idle)
    let room = SnapshotRoom(
      id: "dev", name: "dev", topic: nil, createdAt: "t0", createdBy: "human", standing: true, closedAt: nil,
      messageCount: 1, firstMessageId: 3, members: [seat], messages: [message(3, mentions: ["web"])])
    let panel = AgentsPanel(rooms: [room])
    #expect(panel.shown.first?.hasUnheardMention == true)
  }
}
