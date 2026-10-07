import SwiftUI
import Testing

@testable import Feed

@Suite("Composer")
struct ComposerTests {
  @Test("plain return sends", arguments: [EventModifiers(), .command, .control, .capsLock])
  func sends(modifiers: EventModifiers) {
    #expect(returnSends(modifiers))
  }

  @Test("shift or option return makes a new line", arguments: [EventModifiers.shift, .option, [.shift, .option], [.shift, .capsLock]])
  func newLine(modifiers: EventModifiers) {
    #expect(!returnSends(modifiers))
  }
}
