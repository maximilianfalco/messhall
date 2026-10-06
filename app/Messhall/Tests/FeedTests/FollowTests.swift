import Foundation
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

  @Test("follow waits out the sidebar slide before it scrolls")
  func waitsWhileColumnsMove() {
    let changed = Date(timeIntervalSince1970: 100)
    #expect(abs(Follow.wait(columnsChangedAt: changed, now: changed.addingTimeInterval(0.1)) - 0.3) < 0.001)
  }

  @Test(
    "follow does not wait once the slide is over or when the columns never moved",
    arguments: [0.5, 2.0])
  func noWaitAfterSettle(elapsed: Double) {
    let changed = Date(timeIntervalSince1970: 100)
    #expect(Follow.wait(columnsChangedAt: changed, now: changed.addingTimeInterval(elapsed)) == 0)
    #expect(Follow.wait(columnsChangedAt: nil, now: changed) == 0)
  }

  @Test("a fold that opens or closes near the bottom lands flush at the end with no animation")
  func toggleAtBottom() {
    #expect(Follow.afterToggle(nearBottom: true) == .scroll(animated: false))
  }

  @Test("a fold that opens or closes while scrolled up leaves the reader where they are")
  func toggleScrolledUp() {
    #expect(Follow.afterToggle(nearBottom: false) == .none)
  }
}
