import Foundation
import Testing

@testable import Feed

@Suite("Member type")
struct MemberTypeTests {
  static func member(
    name: String = "web", kind: MemberKind = .other, client: String?, version: String?, label: String?,
    role: String = "unassigned"
  ) -> Member {
    Member(
      roomId: "r1", name: name, kind: kind, clientLabel: label, clientName: client, clientVersion: version,
      presence: .waiting, role: role, cursor: 0, done: false, joinedAt: "t0", lastSeenAt: "t0", leftAt: nil)
  }

  @Test("the role pill shows a set role")
  func rolePill() {
    #expect(Self.member(client: nil, version: nil, label: nil, role: "reviewer").rolePill == "reviewer")
  }

  @Test("the role pill hides for unassigned and for the human seat")
  func rolePillHidden() {
    #expect(Self.member(client: nil, version: nil, label: nil).rolePill == nil)
    #expect(
      Self.member(name: "human", kind: .human, client: nil, version: nil, label: nil, role: "observer").rolePill == nil)
  }

  @Test("an observer reads as one so its chip dims, any other role does not")
  func isObserver() {
    #expect(Self.member(client: nil, version: nil, label: nil, role: "observer").isObserver)
    #expect(!Self.member(client: nil, version: nil, label: nil, role: "worker").isObserver)
  }

  @Test("an agent offers every usual role but its own")
  func roleChoices() {
    #expect(
      Self.member(client: nil, version: nil, label: nil, role: "worker").roleChoices == [
        "reviewer", "orchestrator", "observer", "unassigned",
      ])
  }

  @Test("the human seat offers no roles")
  func roleChoicesHuman() {
    #expect(Self.member(name: "human", kind: .human, client: nil, version: nil, label: nil).roleChoices == [])
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

  @Test("an agent offers Mute, a muted one Unmute and says so, the human seat neither")
  func muteAction() {
    var web = Self.member(client: nil, version: nil, label: nil)
    #expect(web.muteAction == "Mute")
    web.muted = true

    #expect(web.muteAction == "Unmute")
    #expect(web.spokenLabel(as: "web") == "web, other, waiting, muted")
    #expect(web.help(as: "web") == "web runs on other and is waiting, muted")
    #expect(Self.member(name: "human", kind: .human, client: nil, version: nil, label: nil).muteAction == nil)
  }

  @Test("decode the status of a member")
  func decodeStatus() throws {
    let member = try Fixture.decode(Member.self, "Member")

    #expect(member.status == "tests green")
    #expect(member.statusAt == "2026-01-01T09:04:00.000Z")
  }

  static func withStatus(_ status: String?, at: String? = "2026-01-01T10:00:00.000Z") -> Member {
    var web = member(client: "opencode", version: "1.18.34", label: "opencode")
    web.status = status
    web.statusAt = at
    return web
  }

  @Test(
    "the status line says how long ago it was set",
    arguments: [
      ("2026-01-01T10:00:30.000Z", "tests green · just now"),
      ("2026-01-01T10:03:00.000Z", "tests green · 3m ago"),
      ("2026-01-01T12:10:00.000Z", "tests green · 2h ago"),
      ("2026-01-03T10:00:00.000Z", "tests green · 2d ago"),
    ])
  func statusLine(now: String, line: String) throws {
    let at = try Date(now, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true))

    #expect(Self.withStatus("tests green").statusLine(now: at) == line)
  }

  @Test("no status, no status line")
  func noStatusLine() {
    #expect(Self.withStatus(nil, at: nil).statusLine(now: Date()) == nil)
  }

  @Test("the spoken label and help end with the status")
  func spokenStatus() {
    let web = Self.withStatus("tests green")

    #expect(web.spokenLabel(as: "web") == "web, opencode 1.18.34, waiting, tests green")
    #expect(web.help(as: "web") == "web runs on opencode 1.18.34 and is waiting: tests green")
  }

  @Test("a member with no client falls back to its kind")
  func noClient() {
    let old = Self.member(kind: .codex, client: nil, version: nil, label: nil)

    #expect(old.spokenLabel(as: "web") == "web, codex, waiting")
    #expect(old.help(as: "web") == "web runs on codex and is waiting")
  }

  static func message(label: String?) -> Message {
    Message(
      id: 3, roomId: "r1", from: "ci", fromClientLabel: label, fromKind: .other, kind: .chat, text: "green",
      mentions: [], createdAt: "t0")
  }

  @Test("the pill comes from the post, so a sender who left keeps it")
  func leftSender() {
    #expect(Self.message(label: "script").typeLabel(sender: nil) == "script")
  }

  @Test("the post label wins over the member, and the member fills in when the post has none")
  func pillOrder() {
    let web = Self.member(client: "opencode", version: nil, label: "opencode")

    #expect(Self.message(label: "script").typeLabel(sender: web) == "script")
    #expect(Self.message(label: nil).typeLabel(sender: web) == "opencode")
    #expect(Self.message(label: nil).typeLabel(sender: nil) == nil)
  }

  @Test("decode the sender fields of a post")
  func decodeSender() throws {
    guard case .message(let event) = try Fixture.decode(BusEvent.self, "MessageEvent") else {
      Issue.record("not a message event")
      return
    }

    #expect(event.message.fromClientLabel == "opencode")
    #expect(event.message.fromKind == .other)
  }

  @Test("members who left stay in the room but not among those present")
  func present() throws {
    var room = try #require(try Fixture.decode(Snapshot.self, "Snapshot").rooms.first)
    room.members.append(Self.member(client: "messhall-cli", version: nil, label: "script"))
    room.members[2].presence = .left

    #expect(room.members.map(\.name) == ["api", "human", "web"])
    #expect(room.present.map(\.name) == ["api", "human"])
  }
}
