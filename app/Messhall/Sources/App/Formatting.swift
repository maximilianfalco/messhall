import Feed
import SwiftUI


func plural(_ count: Int, _ noun: String) -> String {
  "\(count) \(noun)\(count == 1 ? "" : "s")"
}

extension SnapshotRoom {
  var agentSummary: String {
    let active = liveAgents.filter { $0.presence == .active }.count
    let count = plural(liveAgents.count, "agent")
    return active > 0 ? "\(count), \(active) active" : count
  }
}

extension Message {
  var time: String {
    guard let date = try? Date(createdAt, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)) else {
      return ""
    }
    return date.formatted(date: .omitted, time: .shortened)
  }
}

extension Member {
  var displayName: String { kind == .human ? youLabel : name }
}

extension MemberKind {
  var symbol: String {
    switch self {
    case .claude: "sparkle"
    case .codex: "terminal"
    case .other: "cpu"
    case .human: "person.fill"
    }
  }
}

extension Presence {
  var label: String { rawValue.capitalized }

  var color: Color {
    switch self {
    case .active: .green
    case .waiting: .orange
    case .idle, .away, .left: .secondary
    }
  }
}
