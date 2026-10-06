import Foundation

/// When the transcript follows new messages and when it leaves the reader where they are.
public enum Follow {
  public enum Action: Equatable, Sendable {
    case scroll(animated: Bool)
    case showPill
    case none
  }

  /// How far above the bottom, in points, still counts as at the bottom.
  public static let slack = 48.0

  /// Whether the content ends within `slack` of the viewport's bottom edge.
  /// `contentBottom` is the content's bottom edge measured from the viewport's top.
  public static func isNearBottom(contentBottom: Double, viewportHeight: Double) -> Bool {
    contentBottom - viewportHeight <= slack
  }

  /// How long the split view takes to slide a column in or out, in seconds.
  public static let settle = 0.4

  /// Seconds to hold a follow scroll so it does not fight a column slide. Zero once the slide is over.
  public static func wait(columnsChangedAt: Date?, now: Date) -> Double {
    guard let columnsChangedAt else { return 0 }
    return max(0, settle - now.timeIntervalSince(columnsChangedAt))
  }

  /// What to do when the last message id changes. A smaller or equal id is a filter change, not a new message.
  public static func action(lastBefore: Int?, lastAfter: Int?, fromHuman: Bool, nearBottom: Bool) -> Action {
    guard let lastAfter else { return .none }
    guard let lastBefore else { return .scroll(animated: false) }
    guard lastAfter > lastBefore else { return .none }
    return nearBottom || fromHuman ? .scroll(animated: true) : .showPill
  }

  /// What to do after a fold opens or closes. Near the bottom it stays flush with the end, else the reader stays put.
  public static func afterToggle(nearBottom: Bool) -> Action {
    nearBottom ? .scroll(animated: false) : .none
  }
}
