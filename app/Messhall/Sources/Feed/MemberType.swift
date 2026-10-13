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

  private static let orchestratorClaim = #"\b(i am|i'm|im|made me|me as|am now)( now)?( the| an?)? orchestrator\b"#

  /// True when the status or last post claims the orchestrator role for itself but the seat holds no such role, so the menu can offer it.
  public func claimsOrchestrator(status: String?, post: String?) -> Bool {
    guard kind != .human, role != "orchestrator" else { return false }
    return [status, post].contains { $0?.range(of: Self.orchestratorClaim, options: [.regularExpression, .caseInsensitive]) != nil }
  }

  /// The chip menu item that flips the mute. None for the human seat, which cannot be muted.
  public var muteAction: String? {
    kind == .human ? nil : muted ? "Unmute" : "Mute"
  }

  /// `web, opencode 1.18.34, waiting, tests green`. A member with no client says its kind instead.
  public func spokenLabel(as displayName: String) -> String {
    "\(displayName), \(client ?? kind.rawValue), \(presence.rawValue)\(muted ? ", muted" : "")\(done ? ", signed off" : "")"
      + (status.map { ", \($0)" } ?? "")
  }

  /// `web runs on opencode 1.18.34 and is waiting: tests green`, the hover help on the chip.
  public func help(as displayName: String) -> String {
    "\(displayName) runs on \(client ?? kind.rawValue) and is \(presence.rawValue)\(muted ? ", muted" : "")\(done ? ", signed off" : "")"
      + (status.map { ": \($0)" } ?? "")
  }

  /// True when the status is an hour old or the member posted after setting it, so the chip can dim it.
  public func isStatusStale(now: Date, lastPostAt: String? = nil) -> Bool {
    guard status != nil, let at = statusAt.flatMap(Self.parseStatusTime) else { return false }
    let posted = lastPostAt.flatMap(Self.parseStatusTime)
    return now.timeIntervalSince(at) >= 3600 || posted.map { $0 > at } == true
  }

  private static func parseStatusTime(_ text: String) -> Date? {
    try? Date(text, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true))
  }

  /// `tests green · 3m ago`, the status under the presence on the chip. Nil when the member set none.
  public func statusLine(now: Date) -> String? {
    guard let status else { return nil }
    let at = statusAt.flatMap(Self.parseStatusTime)
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

extension Reach {
  /// The small label on a chip or agent row. Empty for a value this build does not know.
  public var label: String {
    switch self {
    case .spawned: "spawned"
    case .doorbell: "doorbell"
    case .noDoorbell: "no doorbell"
    case .unknown: ""
    }
  }

  /// The tooltip that says what the label means.
  public var help: String {
    switch self {
    case .spawned: "Spawned: messhall started it in its own tmux session, so it can type into it."
    case .doorbell: "Doorbell: started with messhall claude, so a mention rings it through the channel."
    case .noDoorbell:
      "No doorbell: a plain claude or other client. It hears the room only while it sits in wait, and an invite needs a paste."
    case .unknown: ""
    }
  }
}

extension Message {
  /// The type pill on a chat line. The label stamped on the post wins, so a sender who left keeps it.
  public func typeLabel(sender: Member?) -> String? {
    fromClientLabel ?? sender?.clientLabel
  }
}

/// The line under a mention the agent cannot hear.
public let unheardMentionHint = "cant hear you, no doorbell, it reads the room on its next call"
