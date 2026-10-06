import Testing

@testable import Feed

@Suite("Room copy")
struct RoomCopyTests {
  private func member(_ name: String, kind: MemberKind, presence: Presence = .waiting) -> Member {
    var member = MemberTypeTests.member(name: name, kind: kind, client: nil, version: nil, label: nil)
    member.presence = presence
    return member
  }

  @Test("the join prompt names the room for any agent to paste")
  func prompt() {
    #expect(
      JoinPrompt.prompt(room: "checkout")
        == "Join the messhall room #checkout with the messhall MCP tools: call join (room \"checkout\", pick a short role name, Codex also passes thread_id from $CODEX_THREAD_ID), then call wait and reply only to what concerns you."
    )
  }

  @Test("the launch command starts claude in the room")
  func launch() {
    #expect(JoinPrompt.launchCommand(room: "checkout") == "messhall claude --room checkout")
  }

  @Test("the copy button says Copied for a moment after a click")
  func buttonLabel() {
    #expect(JoinPrompt.buttonLabel(copied: false) == "Copy Join Prompt")
    #expect(JoinPrompt.buttonLabel(copied: true) == "Copied")
  }

  @Test("a room with only the human asks for an agent")
  func onlyHuman() {
    #expect(EmptyRoomCopy.pick(members: [member("human", kind: .human)]) == .startAgent)
    #expect(EmptyRoomCopy.pick(members: []) == .startAgent)
  }

  @Test("a room whose agents all left asks for an agent")
  func agentsLeft() {
    let members = [member("human", kind: .human), member("api", kind: .claude, presence: .left)]

    #expect(EmptyRoomCopy.pick(members: members) == .startAgent)
  }

  @Test("a room with an agent waits for posts")
  func withAgent() {
    let members = [member("human", kind: .human), member("api", kind: .claude)]

    #expect(EmptyRoomCopy.pick(members: members) == .waitForPosts)
  }
}
