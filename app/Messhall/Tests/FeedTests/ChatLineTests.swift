import Testing

@testable import Feed

@Suite("Chat line")
struct ChatLineTests {
  private func chat(from: String, text: String, label: String? = nil) -> Message {
    Message(
      id: 1, roomId: "r1", from: from, fromClientLabel: label, kind: .chat, text: text, mentions: [],
      createdAt: "2026-01-01T09:00:00.000Z")
  }

  @Test("a human message is a full row on the right under You")
  func human() {
    let line = chat(from: "human", text: "how is it going").chatLine(sender: nil)

    #expect(line == ChatLine(title: "You", text: "how is it going", mine: true, pill: nil))
  }

  @Test("a human message keeps its row when the human seat is in the members")
  func humanWithSeat() {
    let seat = MemberTypeTests.member(name: "human", kind: .human, client: nil, version: nil, label: nil)
    let line = chat(from: "human", text: "ship it").chatLine(sender: seat)

    #expect(line.title == "You")
    #expect(line.text == "ship it")
    #expect(line.mine)
  }

  @Test("an agent message is on the left under its name with its type pill")
  func agent() {
    let line = chat(from: "web", text: "on it", label: "codex").chatLine(sender: nil)

    #expect(line == ChatLine(title: "web", text: "on it", mine: false, pill: "codex"))
  }
}
