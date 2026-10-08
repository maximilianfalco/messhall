import Testing

@testable import Feed

private func option(_ label: String) -> QuestionOption { QuestionOption(label: label) }

private let merge = QuestionItem(header: "Merge", question: "merge now?", options: [option("ship it"), option("wait")])
private let suites = QuestionItem(
  header: "Suites", question: "which run?", multiSelect: true, options: [option("unit"), option("e2e"), option("smoke")])

private func ask(_ items: [QuestionItem], answers: [QuestionAnswer]? = nil, state: QuestionState = .open) -> Question {
  Question(
    id: "q1", room: "checkout", member: "api", messageId: 3, items: items, state: state, answers: answers,
    createdAt: "2026-01-01T09:00:00.000Z", answeredAt: nil)
}

@Suite("QuestionDraft")
struct QuestionDraftTests {
  @Test("starts with nothing picked and cannot be sent")
  func empty() {
    let draft = QuestionDraft(items: [merge, suites])

    #expect(draft.answers == nil)
    #expect(!draft.isPicked(0, in: 0))
  }

  @Test("a pick one question keeps only the last pick")
  func pickOne() {
    var draft = QuestionDraft(items: [merge])

    draft.toggle(0, in: 0)
    draft.toggle(1, in: 0)

    #expect(draft.answers == [QuestionAnswer(picks: [1])])
  }

  @Test("a pick any question toggles each pick and sends them in option order")
  func pickAny() {
    var draft = QuestionDraft(items: [suites])

    draft.toggle(2, in: 0)
    draft.toggle(0, in: 0)
    draft.toggle(1, in: 0)
    draft.toggle(1, in: 0)

    #expect(draft.answers == [QuestionAnswer(picks: [0, 2])])
  }

  @Test("typing on a pick one question replaces its pick, and a pick after drops the typed text from the answer")
  func typedPickOne() {
    var draft = QuestionDraft(items: [merge])
    draft.toggle(0, in: 0)

    draft.setOther("  after lunch ", in: 0)
    #expect(draft.answers == [QuestionAnswer(picks: [], other: "after lunch")])
    #expect(!draft.isPicked(0, in: 0))

    draft.toggle(1, in: 0)
    #expect(draft.answers == [QuestionAnswer(picks: [1])])
    #expect(draft.other(in: 0) == "  after lunch ")
  }

  @Test("typing on a pick any question sends next to the picks")
  func typedPickAny() {
    var draft = QuestionDraft(items: [suites])
    draft.toggle(1, in: 0)

    draft.setOther("lint", in: 0)

    #expect(draft.answers == [QuestionAnswer(picks: [1], other: "lint")])
  }

  @Test("typed text stops at the daemon's 300 char cap")
  func otherCap() {
    var draft = QuestionDraft(items: [merge])

    draft.setOther(String(repeating: "a", count: 310), in: 0)

    #expect(draft.other(in: 0) == String(repeating: "a", count: 300))
  }

  @Test("blank typed text counts as nothing")
  func blank() {
    var draft = QuestionDraft(items: [merge])

    draft.setOther("   ", in: 0)

    #expect(draft.answers == nil)
  }

  @Test("cannot be sent until every question has an answer")
  func everyQuestion() {
    var draft = QuestionDraft(items: [merge, suites])
    draft.toggle(0, in: 0)
    #expect(draft.answers == nil)

    draft.toggle(2, in: 1)

    #expect(draft.answers == [QuestionAnswer(picks: [0]), QuestionAnswer(picks: [2])])
  }
}

@Suite("Question.picked")
struct QuestionPickedTests {
  @Test("names the picked label of one plain question")
  func one() {
    let plain = QuestionItem(header: nil, question: "merge now?", options: [option("ship it"), option("wait")])

    #expect(ask([plain], answers: [QuestionAnswer(picks: [1])]).picked == "wait")
  }

  @Test("names each header with its picks and typed text in quotes")
  func many() {
    let answers = [QuestionAnswer(picks: [0]), QuestionAnswer(picks: [0, 2], other: "lint")]

    #expect(ask([merge, suites], answers: answers).picked == #"Merge: ship it · Suites: unit, smoke, "lint""#)
  }

  @Test("is nil before an answer")
  func open() {
    #expect(ask([merge]).picked == nil)
  }
}
