import Foundation

extension Member {
  /// The exact client name and version the agent sent at join, like `opencode 1.18.34`. Nil when it sent none.
  public var client: String? {
    clientName.map { [$0, clientVersion].compactMap(\.self).joined(separator: " ") }
  }

  /// The role pill next to the type pill. Nil when no role is set, and on the human seat.
  public var rolePill: String? {
    kind == .human || role == "unassigned" ? nil : role
  }

  /// True for an observer, which reads the room but never counts as one of its agents.
  public var isObserver: Bool { role == "observer" }

  static let usualRoles = ["worker", "reviewer", "orchestrator", "observer", "unassigned"]

  /// The roles the human can pick for this member. None for the human seat.
  public var roleChoices: [String] {
    kind == .human ? [] : Self.usualRoles.filter { $0 != role }
  }

  /// The chip menu item that flips the mute. None for the human seat, which cannot be muted.
  public var muteAction: String? {
    kind == .human ? nil : muted ? "Unmute" : "Mute"
  }

  /// `web, opencode 1.18.34, waiting, tests green`. A member with no client says its kind instead.
  public func spokenLabel(as displayName: String) -> String {
    "\(displayName), \(client ?? kind.rawValue), \(presence.rawValue)\(muted ? ", muted" : "")"
      + (status.map { ", \($0)" } ?? "")
  }

  /// `web runs on opencode 1.18.34 and is waiting: tests green`, the hover help on the chip.
  public func help(as displayName: String) -> String {
    "\(displayName) runs on \(client ?? kind.rawValue) and is \(presence.rawValue)\(muted ? ", muted" : "")"
      + (status.map { ": \($0)" } ?? "")
  }

  /// `tests green · 3m ago`, the status under the presence on the chip. Nil when the member set none.
  public func statusLine(now: Date) -> String? {
    guard let status else { return nil }
    let at = statusAt.flatMap { try? Date($0, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)) }
    guard let at else { return status }
    let minutes = Int(now.timeIntervalSince(at) / 60)
    let age =
      switch minutes {
      case ..<1: "just now"
      case ..<60: "\(minutes)m ago"
      case ..<(24 * 60): "\(minutes / 60)h ago"
      default: "\(minutes / (24 * 60))d ago"
      }
    return "\(status) · \(age)"
  }
}

extension Message {
  /// The type pill on a chat line. The label stamped on the post wins, so a sender who left keeps it.
  public func typeLabel(sender: Member?) -> String? {
    fromClientLabel ?? sender?.clientLabel
  }
}
