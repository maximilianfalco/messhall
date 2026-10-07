import Foundation
import Testing

@testable import Feed

@MainActor
@Suite("Thinking clock")
struct ThinkingClockTests {
  @Test("it ticks only while someone is thinking and a window shows")
  func ticks() {
    let clock = ThinkingClock()
    #expect(!clock.isTicking)

    clock.thinking = true
    #expect(clock.isTicking)

    clock.visible = false
    #expect(!clock.isTicking)

    clock.visible = true
    #expect(clock.isTicking)

    clock.thinking = false
    #expect(!clock.isTicking)
  }

  @Test("a tick moves the frame every spinner reads")
  func frame() {
    let clock = ThinkingClock()
    let at = Date(timeIntervalSinceReferenceDate: 1000)

    clock.tick(at: at)

    #expect(clock.frame == at)
  }

  @Test("the minute moves on its own tick, not with the frames")
  func minute() {
    let clock = ThinkingClock()
    let start = clock.minute
    let at = Date(timeIntervalSinceReferenceDate: 1000)

    clock.tick(at: at)
    #expect(clock.minute == start)

    clock.tickMinute(at: at)
    #expect(clock.minute == at)
  }
}
