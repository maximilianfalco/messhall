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

  /// `web, opencode 1.18.34, waiting`. A member with no client says its kind instead.
  public func spokenLabel(as displayName: String) -> String {
    "\(displayName), \(client ?? kind.rawValue), \(presence.rawValue)\(muted ? ", muted" : "")"
  }

  /// `web runs on opencode 1.18.34 and is waiting`, the hover help on the chip.
  public func help(as displayName: String) -> String {
    "\(displayName) runs on \(client ?? kind.rawValue) and is \(presence.rawValue)\(muted ? ", muted" : "")"
  }
}

extension Message {
  /// The type pill on a chat line. The label stamped on the post wins, so a sender who left keeps it.
  public func typeLabel(sender: Member?) -> String? {
    fromClientLabel ?? sender?.clientLabel
  }
}
