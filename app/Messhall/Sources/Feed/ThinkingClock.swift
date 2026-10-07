import Foundation
import Observation

/// One clock for every spinner. It ticks only while someone is thinking and a window shows, so a quiet app pays nothing.
@MainActor
@Observable
public final class ThinkingClock {
  public static let shared = ThinkingClock()

  /// The frame every spinning glyph and shimmer reads.
  public private(set) var frame = Date()
  /// The minute every status age reads.
  public private(set) var minute = Date()
  /// True while some status line spins. The app sets it from the feed.
  @ObservationIgnored public var thinking = false {
    didSet { settle() }
  }
  /// True while a window of the app shows. The app sets it from the windows' occlusion.
  @ObservationIgnored public var visible = true {
    didSet { settle() }
  }
  @ObservationIgnored private var frames: Timer?
  @ObservationIgnored private var minutes: Timer?

  public init() {
    minutes = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.tickMinute(at: Date()) }
    }
  }

  public var isTicking: Bool { frames != nil }

  func tick(at date: Date) {
    frame = date
  }

  func tickMinute(at date: Date) {
    minute = date
  }

  private func settle() {
    let wants = thinking && visible
    guard wants != isTicking else { return }
    frames?.invalidate()
    frames =
      wants
      ? Timer.scheduledTimer(withTimeInterval: Thinking.step, repeats: true) { [weak self] _ in
        MainActor.assumeIsolated { self?.tick(at: Date()) }
      } : nil
  }
}
