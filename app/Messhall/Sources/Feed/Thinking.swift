import Foundation

/// The glyph and shimmer before a working agent's status, like Claude Code's thinking spinner.
public enum Thinking {
  /// Out and back, so the loop never jumps from the last glyph to the first.
  static let frames = ["✻", "✳", "✶", "✢", "✶", "✳"]
  public static let step: TimeInterval = 0.12
  public static let sweep: TimeInterval = 2

  /// The glyph at `date`. Still, it is always the first one.
  public static func glyph(at date: Date, animated: Bool) -> String {
    guard animated else { return frames[0] }
    let index = Int((date.timeIntervalSinceReferenceDate / step).rounded()) % frames.count
    return frames[index]
  }

  /// How far the shimmer has crossed the text at `date`, from 0 to 1.
  public static func shimmer(at date: Date) -> Double {
    date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: sweep) / sweep
  }
}

extension Member {
  /// Active with a status, so its glyph spins and its status shimmers.
  public var isThinking: Bool { presence == .active && status != nil }
}
