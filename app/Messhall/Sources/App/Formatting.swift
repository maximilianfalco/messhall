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

// Parsing and formatting a stamp cost more than the rest of a row, and a row draws its stamp on each build.
@MainActor private var times: [String: String] = [:]

extension Message {
  @MainActor var time: String {
    if let known = times[createdAt] { return known }
    let date = try? Date(createdAt, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true))
    let text = date?.formatted(date: .omitted, time: .shortened) ?? ""
    times[createdAt] = text
    return text
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
    case .other, .unknown: "cpu"
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
    case .reconnecting: .yellow
    case .invited, .idle, .away, .left, .unknown: .secondary
    }
  }
}
