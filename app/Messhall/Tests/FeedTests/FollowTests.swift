import Testing

@testable import Feed

@Suite("Follow")
struct FollowTests {
  @Test(
    "the view is near the bottom when the content ends within the slack of the viewport",
    arguments: [(600.0, 600.0, true), (640.0, 600.0, true), (700.0, 600.0, false), (300.0, 600.0, true)])
  func nearBottom(contentBottom: Double, viewport: Double, expected: Bool) {
    #expect(Follow.isNearBottom(contentBottom: contentBottom, viewportHeight: viewport) == expected)
  }

  @Test("a new message scrolls with an animation when the view is near the bottom")
  func followsAtBottom() {
    #expect(Follow.action(lastBefore: 4, lastAfter: 5, fromHuman: false, nearBottom: true) == .scroll(animated: true))
  }

  @Test("a new message shows the pill and does not move a view scrolled up")
  func pillWhenScrolledUp() {
    #expect(Follow.action(lastBefore: 4, lastAfter: 5, fromHuman: false, nearBottom: false) == .showPill)
  }

  @Test("the human's own post always scrolls down")
  func ownPost() {
    #expect(Follow.action(lastBefore: 4, lastAfter: 5, fromHuman: true, nearBottom: false) == .scroll(animated: true))
  }

  @Test("the first messages land at the bottom with no animation")
  func firstLoad() {
    #expect(Follow.action(lastBefore: nil, lastAfter: 5, fromHuman: false, nearBottom: true) == .scroll(animated: false))
    #expect(Follow.action(lastBefore: nil, lastAfter: 5, fromHuman: false, nearBottom: false) == .scroll(animated: false))
  }

  @Test("an older or missing last message, like a filter change, does nothing")
  func noNewMessage() {
    #expect(Follow.action(lastBefore: 9, lastAfter: 5, fromHuman: false, nearBottom: true) == .none)
    #expect(Follow.action(lastBefore: 9, lastAfter: nil, fromHuman: false, nearBottom: true) == .none)
    #expect(Follow.action(lastBefore: 9, lastAfter: 9, fromHuman: false, nearBottom: false) == .none)
  }
}
