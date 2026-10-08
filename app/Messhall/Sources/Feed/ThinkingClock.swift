import Foundation
import Observation

/// One clock for every status age. It ticks once a minute, so ages move without a feed event.
@MainActor
@Observable
public final class ThinkingClock {
  public static let shared = ThinkingClock()

  /// The minute every status age reads.
  public private(set) var minute = Date()
  @ObservationIgnored private var minutes: Timer?

  public init() {
    minutes = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.tickMinute(at: Date()) }
    }
  }

  func tickMinute(at date: Date) {
    minute = date
  }
}
