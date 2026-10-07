import SwiftUI

/// True when Return in the composer picks or sends. Shift or Option with it makes a new line instead.
public func returnSends(_ modifiers: EventModifiers) -> Bool {
  modifiers.isDisjoint(with: [.shift, .option])
}
