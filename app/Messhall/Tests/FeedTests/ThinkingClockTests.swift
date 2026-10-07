import Foundation
import Testing

@testable import Feed

@MainActor
@Suite("Thinking clock")
struct ThinkingClockTests {
  @Test("the minute moves on its tick")
  func minute() {
    let clock = ThinkingClock()
    let at = Date(timeIntervalSinceReferenceDate: 1000)

    clock.tickMinute(at: at)

    #expect(clock.minute == at)
  }
}
