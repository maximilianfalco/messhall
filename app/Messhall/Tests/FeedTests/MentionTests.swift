import Testing

@testable import Feed

@Suite("Mentions")
struct MentionTests {
  private func member(_ name: String, kind: MemberKind = .claude, presence: Presence = .active) -> Member {
    Member(
      roomId: "r1", name: name, kind: kind, clientLabel: nil, clientName: nil, clientVersion: nil,
      presence: presence, role: "unassigned", cursor: 0, done: false, joinedAt: "t0", lastSeenAt: "t0", leftAt: nil)
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

  @Test("the picker marks the name moved to while it still matches, else the first")
  func picked() {
    #expect(pickedMention("web", in: ["api", "web"]) == "web")
    #expect(pickedMention("qa", in: ["api", "web"]) == "api")
    #expect(pickedMention(nil, in: ["api", "web"]) == "api")
    #expect(pickedMention("web", in: []) == nil)
  }

  @Test("arrow steps wrap at both ends of the list")
  func step() {
    let names = ["api", "web", "all"]

    #expect(steppedMention(from: "api", by: 1, in: names) == "web")
    #expect(steppedMention(from: "all", by: 1, in: names) == "api")
    #expect(steppedMention(from: "api", by: -1, in: names) == "all")
    #expect(steppedMention(from: "qa", by: 1, in: names) == nil)
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

  @Test(
    "a draft of only mentions has nothing to say",
    arguments: ["@lang-switch", "@lang-switch ", " @api  @web\n", "@all", "@ghost"])
  func onlyMentionsDraft(draft: String) {
    #expect(onlyMentions(draft))
  }

  @Test(
    "a draft with any words besides its mentions has something to say",
    arguments: ["@api hi", "hi @api", "@api ?", "mail dev@web", "@Web", ""])
  func saysSomething(draft: String) {
    #expect(!onlyMentions(draft))
  }
}
