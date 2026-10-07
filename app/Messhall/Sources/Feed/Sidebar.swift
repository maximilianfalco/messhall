import Foundation

extension SnapshotRoom {
  /// The live agent count the room's sidebar row shows. Nil when there is none, so the row stays one line.
  public var sidebarAgentCount: Int? {
    let count = liveAgents.count
    return count > 0 ? count : nil
  }
}

/// How many chat or done lines landed after the last one the human saw in a room.
public func unreadCount(messages: [Message], seenId: Int) -> Int {
  messages.count { $0.id > seenId && ($0.kind == .chat || $0.kind == .done) }
}
