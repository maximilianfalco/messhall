import Testing

@testable import Feed

@Suite("Transcript filter")
struct TranscriptFilterTests {
  private func message(_ id: Int, from: String, _ text: String) -> Message {
    Message(
      id: id, roomId: "r1", from: from, kind: .chat, text: text, mentions: [], createdAt: "2026-01-01T09:00:00.000Z")
  }

  private var messages: [Message] {
    [
      message(1, from: "api", "Prices move to cents"),
      message(2, from: "web", "ok, dollars stay"),
      message(3, from: "human", "ship it"),
    ]
  }

  @Test("an empty or blank query keeps every message")
  func blank() {
    #expect(messages.matching("").map(\.id) == [1, 2, 3])
    #expect(messages.matching("   ").map(\.id) == [1, 2, 3])
  }

  @Test("keeps messages whose text has the query, any case, in order")
  func text() {
    #expect(messages.matching("CENT").map(\.id) == [1])
    #expect(messages.matching(" ok ").map(\.id) == [2])
  }

  @Test("matches the sender too")
  func sender() {
    #expect(messages.matching("web").map(\.id) == [2])
  }

  @Test("keeps nothing when nothing matches")
  func none() {
    #expect(messages.matching("euros").isEmpty)
  }
}
