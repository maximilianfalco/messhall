import Foundation

/// Which transcript rows get built for real. The rest stand behind two spacers sized from the heights seen so far,
/// so the content height stays true where it was measured and the view never holds thousands of rows.
public enum RowWindow {
  /// A transcript with this many rows or fewer is all real, like before.
  public static let eagerBelow = 120
  /// The newest rows a long transcript starts with, before the first scroll geometry lands.
  public static let first = 40
  /// The height of a row never measured, until some were.
  public static let defaultHeight = 44.0

  /// The rows whose span meets the band, widened by `margin` on both ends. Row tops count the spacing between rows.
  public static func range(heights: [Double], spacing: Double, top: Double, bottom: Double, margin: Double) -> Range<Int> {
    var tops: [Double] = []
    tops.reserveCapacity(heights.count)
    var y = 0.0
    for height in heights {
      tops.append(y)
      y += height + spacing
    }
    let lower = firstIndex(in: heights.indices) { tops[$0] + heights[$0] > top - margin }
    let upper = firstIndex(in: heights.indices) { tops[$0] >= bottom + margin }
    return lower..<max(lower, upper)
  }

  /// The heights of the two spacers around the window: every row above it and every row below it, spacing included.
  public static func spacers(heights: [Double], spacing: Double, window: Range<Int>) -> (above: Double, below: Double) {
    let block = { (rows: Range<Int>) -> Double in
      rows.isEmpty ? 0 : heights[rows].reduce(0, +) + spacing * Double(rows.count - 1)
    }
    return (block(0..<window.lowerBound), block(window.upperBound..<heights.count))
  }

  public static func covers(_ window: Range<Int>, needed: Range<Int>) -> Bool {
    window.lowerBound <= needed.lowerBound && needed.upperBound <= window.upperBound
  }

  /// The row indices whose ids fall in `ids`. Rows are in id order, so this is a binary search.
  public static func indices(ofIds ids: ClosedRange<Int>, in rows: [TranscriptItem]) -> Range<Int> {
    let lower = firstIndex(in: rows.indices) { rows[$0].id >= ids.lowerBound }
    let upper = firstIndex(in: rows.indices) { rows[$0].id > ids.upperBound }
    return lower..<max(lower, upper)
  }

  /// The ids at both ends of the window, nil for an empty one.
  public static func ids(of window: Range<Int>, in rows: [TranscriptItem]) -> ClosedRange<Int>? {
    guard !window.isEmpty else { return nil }
    return rows[window.lowerBound].id...rows[window.upperBound - 1].id
  }

  public static func start(count: Int) -> Range<Int> {
    count <= eagerBelow ? 0..<count : (count - first)..<count
  }

  /// A window of the newest-row size around one row, for a scroll that aims at a row behind a spacer.
  public static func around(_ index: Int, count: Int) -> Range<Int> {
    max(0, index - first / 2)..<min(count, index + first / 2)
  }

  /// The middle measured height, so a guess sits where most rows do.
  public static func guess(measured: [Double]) -> Double {
    guard !measured.isEmpty else { return defaultHeight }
    return measured.sorted()[measured.count / 2]
  }

  /// The first index for which `holds` is true, or the end. `holds` is false then true along the range.
  private static func firstIndex(in range: Range<Int>, where holds: (Int) -> Bool) -> Int {
    var low = range.lowerBound
    var high = range.upperBound
    while low < high {
      let mid = (low + high) / 2
      if holds(mid) { high = mid } else { low = mid + 1 }
    }
    return low
  }
}
