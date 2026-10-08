import AppKit
import Testing

@testable import Feed

@Suite("Thinking glyph")
struct ThinkingTests {
  private func member(_ presence: Presence, status: String?) -> Member {
    Member(
      roomId: "r1", name: "api", kind: .claude, clientLabel: nil, clientName: nil, clientVersion: nil,
      presence: presence, role: "worker", cursor: 0, done: false, joinedAt: "t0", lastSeenAt: "t0", leftAt: nil,
      status: status)
  }

  @Test("the frames go out and back, so the loop never jumps from the last glyph to the first")
  func cycle() {
    #expect(Thinking.frames == ["✻", "✳", "✶", "✢", "✶", "✳"])
  }

  @Test("a glyph layer is on for its own slot only, so the six layers show one frame at a time")
  func keyframes() {
    #expect(Thinking.keyframes(showing: 2) == [0, 0, 1, 0, 0, 0])
    let sums = Thinking.frames.indices.map { slot in Thinking.frames.indices.map { Thinking.keyframes(showing: $0)[slot] }.reduce(0, +) }
    #expect(sums == [1, 1, 1, 1, 1, 1])
  }

  @Test("every frame fits the glyph box, so the status text never moves as it spins")
  func box() {
    let font = NSFont.preferredFont(forTextStyle: .caption1)
    let box = Thinking.box(for: font)
    let widths = Thinking.frames.map { NSAttributedString(string: $0, attributes: [.font: font]).size().width }
    #expect(widths.allSatisfy { $0 <= box })
    #expect(box == widths.max().map { $0.rounded(.up) })
  }

  @Test("only an active member with a status is thinking", arguments: [
    (Presence.active, String?("tests green"), true), (.active, nil, false), (.waiting, "ci", false), (.idle, "ci", false),
    (.away, "ci", false),
  ])
  func thinking(presence: Presence, status: String?, expected: Bool) {
    #expect(member(presence, status: status).isThinking == expected)
  }
}
