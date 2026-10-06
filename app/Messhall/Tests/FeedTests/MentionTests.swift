import Testing

@testable import Feed

@Suite("Mentions")
struct MentionTests {
  private func member(_ name: String, kind: MemberKind = .claude, presence: Presence = .active) -> Member {
    Member(
      roomId: "r1", name: name, kind: kind, clientLabel: nil, clientName: nil, clientVersion: nil,
      presence: presence, cursor: 0, done: false, joinedAt: "t0", lastSeenAt: "t0", leftAt: nil)
  }

  private func chat(_ text: String, mentions: [String]) -> Message {
    Message(
      id: 1, roomId: "r1", from: "api", kind: .chat, text: text, mentions: mentions,
      createdAt: "2026-01-01T09:00:00.000Z")
  }

  @Test(
    "the query is the partial name after a trailing at sign",
    arguments: [
      ("@", ""), ("hey @", ""), ("hey @we", "we"), ("@f7-app", "f7-app"), ("line one\n@a", "a"),
    ])
  func query(draft: String, expected: String) {
    #expect(mentionQuery(in: draft) == expected)
  }

  @Test(
    "there is no query when the draft does not end in a mention",
    arguments: ["", "hey", "@web ", "mail@web", "@Web", "hey @web done"])
  func noQuery(draft: String) {
    #expect(mentionQuery(in: draft) == nil)
  }

  @Test("the candidates are the members still here and all, never the human")
  func candidates() {
    let members = [member("api"), member("human", kind: .human), member("old", presence: .left), member("web")]

    #expect(mentionCandidates(query: "", members: members) == ["api", "web", "all"])
  }

  @Test("prefix matches come before names that only contain the query")
  func filtered() {
    let members = [member("f7-app-web"), member("api"), member("app")]

    #expect(mentionCandidates(query: "ap", members: members) == ["api", "app", "f7-app-web"])
  }

  @Test("all is offered only when it matches the query")
  func all() {
    #expect(mentionCandidates(query: "al", members: [member("api")]) == ["all"])
    #expect(mentionCandidates(query: "zz", members: [member("api")]) == [])
  }

  @Test("completing swaps the trailing partial for the name and a space")
  func complete() {
    #expect(completeMention("web", in: "hey @w") == "hey @web ")
    #expect(completeMention("all", in: "@") == "@all ")
  }

  @Test(
    "appending adds the mention after a space when the draft needs one",
    arguments: [("", "@web "), ("hey", "hey @web "), ("hey ", "hey @web "), ("hey\n", "hey\n@web ")])
  func append(draft: String, expected: String) {
    #expect(appendMention("web", to: draft) == expected)
  }

  @Test("a message splits into text and the mentions it stored")
  func runs() {
    let message = chat("@web the schema moved, @all see #12 and @ghost", mentions: ["web", "all"])

    #expect(
      message.mentionRuns == [
        .mention("web"), .text(" the schema moved, "), .mention("all"), .text(" see #12 and @ghost"),
      ])
  }

  @Test("an email or a longer name is never cut into a mention")
  func runsSkipLookalikes() {
    let message = chat("mail dev@web or @web-2 now", mentions: ["web"])

    #expect(message.mentionRuns == [.text("mail dev@web or @web-2 now")])
  }

  @Test("a message with no mentions is one text run")
  func runsPlain() {
    #expect(chat("all good", mentions: []).mentionRuns == [.text("all good")])
  }
}
