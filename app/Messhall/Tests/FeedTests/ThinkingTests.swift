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

  @Test("the glyph cycles out and back, one frame per step")
  func cycle() {
    let start = Date(timeIntervalSinceReferenceDate: 0)
    let glyphs = (0..<7).map { Thinking.glyph(at: start + Double($0) * Thinking.step, animated: true) }
    #expect(glyphs == ["✻", "✳", "✶", "✢", "✶", "✳", "✻"])
  }

  @Test("a still glyph never moves")
  func still() {
    let glyphs = (0..<4).map { Thinking.glyph(at: Date(timeIntervalSinceReferenceDate: Double($0)), animated: false) }
    #expect(Set(glyphs) == ["✻"])
  }

  @Test("the shimmer sweeps from 0 to 1 and starts again")
  func shimmer() {
    let start = Date(timeIntervalSinceReferenceDate: 0)
    #expect(Thinking.shimmer(at: start) == 0)
    #expect(Thinking.shimmer(at: start + Thinking.sweep / 2) == 0.5)
    #expect(Thinking.shimmer(at: start + Thinking.sweep * 1.25) == 0.25)
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
