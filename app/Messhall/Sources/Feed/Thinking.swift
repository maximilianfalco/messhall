import AppKit

/// The glyph and shimmer before a working agent's status, like Claude Code's thinking spinner.
public enum Thinking {
  /// Out and back, so the loop never jumps from the last glyph to the first.
  public static let frames = ["✻", "✳", "✶", "✢", "✶", "✳"]
  public static let step: TimeInterval = 0.12
  public static let sweep: TimeInterval = 2

  /// The glyph at `date`. Still, it is always the first one.
  public static func glyph(at date: Date, animated: Bool) -> String {
    frames[index(at: date, animated: animated)]
  }

  /// Which frame shows at `date`. Still, it is always the first one.
  public static func index(at date: Date, animated: Bool) -> Int {
    guard animated else { return 0 }
    return Int((date.timeIntervalSinceReferenceDate / step).rounded()) % frames.count
  }

  /// The width of the widest glyph in `font`, rounded up. Each glyph sits centered in it, since they differ in width.
  public static func box(for font: NSFont) -> CGFloat {
    frames.map { NSAttributedString(string: $0, attributes: [.font: font]).size().width }.max()?.rounded(.up) ?? 0
  }

  /// Opacity per frame slot for the layer that holds glyph `index`: on for its own slot, off for the rest.
  public static func keyframes(showing index: Int) -> [Double] {
    frames.indices.map { $0 == index ? 1 : 0 }
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
