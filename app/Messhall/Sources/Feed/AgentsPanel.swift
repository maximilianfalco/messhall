import Foundation

/// One agent in one room, as the Agents panel shows it.
public struct AgentRow: Equatable, Identifiable, Sendable {
  public let room: String
  public let member: Member
  /// The agent's newest chat or done line among the loaded ones.
  public let lastPost: Message?

  public var id: String { "\(room)/\(member.name)" }

  /// The PR the status links, else the one its last post links.
  public var pullRequest: PullRequestLink? {
    pullRequestLinks(in: member.status ?? "").first ?? pullRequestLinks(in: lastPost?.text ?? "").first
  }

  /// Active or waiting, the green and orange dots. An idle agent is not working, whatever its status says.
  public var isWorking: Bool {
    guard !member.done else { return false }
    switch member.presence {
    case .active, .waiting: return true
    case .idle, .invited, .reconnecting, .away, .left, .unknown: return false
    }
  }

  /// Done agents and away ones with nothing to say go in the fold.
  var folds: Bool { member.done || (member.presence.isAway && member.status == nil) }

  var rank: Int {
    switch member.presence {
    case .active, .waiting: 0
    case .idle, .invited, .reconnecting: 1
    case .away, .left, .unknown: 2
    }
  }
}

/// Every agent in every room: the ones worth a row, and the done or away ones folded under them.
public struct AgentsPanel: Equatable, Sendable {
  public let shown: [AgentRow]
  public let folded: [AgentRow]

  /// How many agents are working, the count on the toolbar button and in the menu bar.
  public var working: Int { shown.filter(\.isWorking).count }

  /// With a `room`, only that room's agents. Without one, every room's.
  public init(rooms: [SnapshotRoom], room only: String? = nil) {
    let rows = rooms.filter { only == nil || $0.name == only }.flatMap { room in
      let lastPosts = Self.lastPosts(in: room.messages)
      return room.members.filter { $0.kind != .human && $0.presence != .left }.map { member in
        AgentRow(room: room.name, member: member, lastPost: lastPosts[member.name])
      }
    }
    .sorted { ($0.room, $0.member.name) < ($1.room, $1.member.name) }
    shown = rows.filter { !$0.folds }.enumerated().sorted { ($0.element.rank, $0.offset) < ($1.element.rank, $1.offset) }
      .map(\.element)
    folded = rows.filter(\.folds)
  }

  /// Each sender's newest chat or done line, in one pass over the loaded messages.
  private static func lastPosts(in messages: [Message]) -> [String: Message] {
    var last: [String: Message] = [:]
    for message in messages where message.kind == .chat || message.kind == .done {
      last[message.from] = message
    }
    return last
  }
}
