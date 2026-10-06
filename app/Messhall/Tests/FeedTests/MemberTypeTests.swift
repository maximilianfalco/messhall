import Testing

@testable import Feed

@Suite("Member type")
struct MemberTypeTests {
  static func member(name: String = "web", kind: MemberKind = .other, client: String?, version: String?, label: String?)
    -> Member
  {
    Member(
      roomId: "r1", name: name, kind: kind, clientLabel: label, clientName: client, clientVersion: version,
      presence: .waiting, cursor: 0, done: false, joinedAt: "t0", lastSeenAt: "t0", leftAt: nil)
  }

  @Test("decode the client fields of a member")
  func decode() throws {
    let member = try Fixture.decode(Member.self, "Member")

    #expect(member.clientLabel == "codex")
    #expect(member.clientName == "codex-mcp-client")
    #expect(member.clientVersion == "0.160.1")
  }

  @Test("the human seat decodes with no client")
  func human() throws {
    let human = try Fixture.decode(Snapshot.self, "Snapshot").rooms[0].members[1]

    #expect(human.clientName == nil)
    #expect(human.client == nil)
  }

  @Test("the client is the exact name and version")
  func client() {
    let crush = Self.member(client: "crush (via mcp-remote 0.14.3)", version: "0.97.1", label: "crush")

    #expect(crush.client == "crush (via mcp-remote 0.14.3) 0.97.1")
    #expect(Self.member(client: "opencode", version: nil, label: "opencode").client == "opencode")
  }

  @Test("the spoken label and help name the exact client")
  func spoken() {
    let web = Self.member(client: "opencode", version: "1.18.34", label: "opencode")

    #expect(web.spokenLabel(as: "web") == "web, opencode 1.18.34, waiting")
    #expect(web.help(as: "web") == "web runs on opencode 1.18.34 and is waiting")
  }

  @Test("a member with no client falls back to its kind")
  func noClient() {
    let old = Self.member(kind: .codex, client: nil, version: nil, label: nil)

    #expect(old.spokenLabel(as: "web") == "web, codex, waiting")
    #expect(old.help(as: "web") == "web runs on codex and is waiting")
  }
}
