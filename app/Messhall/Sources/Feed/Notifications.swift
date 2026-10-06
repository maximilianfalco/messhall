import Foundation

let systemName = "messhall"
// Matches the daemon's line when the human closes a room, so your own close stays quiet.
let humanCloseSuffix = "closed by the human"
let bodyLimit = 120

/// One banner to show: the room it opens, its title and its body.
public struct NotificationContent: Equatable, Sendable {
  public let room: String
  public let title: String
  public let body: String
}

/// What the notification choice needs besides the event itself.
public struct NotifyState: Sendable {
  /// The room as it was before the event applied.
  public var room: SnapshotRoom?
  public var mutedRooms: Set<String>
  public var enabled: Bool
  /// When the current stream opened. Older events are a replay.
  public var liveSince: Date

  public init(room: SnapshotRoom?, mutedRooms: Set<String>, enabled: Bool, liveSince: Date) {
    self.room = room
    self.mutedRooms = mutedRooms
    self.enabled = enabled
    self.liveSince = liveSince
  }
}

/// A daemon timestamp as a date, or nil when it does not parse.
public func parseStamp(_ stamp: String) -> Date? {
  try? Date(stamp, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true))
}

/// The banner a live event earns, or nil: a mention of the human or all, a question from the
/// only agent in the room, or a room that closes. Never for the human's own posts.
public func notificationFor(event: BusEvent, state: NotifyState) -> NotificationContent? {
  guard state.enabled else { return nil }
  switch event {
  case .message(let e):
    guard isLive(e.message.createdAt, since: state.liveSince), wants(e.message, in: state.room) else { return nil }
    return content(room: e.room, from: e.message.from, text: e.message.text, muted: state.mutedRooms)
  case .room(let e):
    guard e.change == .closed, let closedAt = e.room.closedAt, isLive(closedAt, since: state.liveSince) else {
      return nil
    }
    let line = state.room?.messages.last { $0.kind == .system }?.text ?? "room closed"
    guard !line.hasSuffix(humanCloseSuffix) else { return nil }
    return content(room: e.room.name, from: systemName, text: line, muted: state.mutedRooms)
  case .member, .presence, .unknown:
    return nil
  }
}

private func isLive(_ stamp: String, since: Date) -> Bool {
  guard let date = parseStamp(stamp) else { return false }
  return date >= since
}

private func wants(_ message: Message, in room: SnapshotRoom?) -> Bool {
  if message.from == humanName { return false }
  if message.kind == .system { return false }
  if message.mentions.contains(humanName) || message.mentions.contains(allMention) { return true }
  guard message.kind == .chat, message.text.trimmingCharacters(in: .whitespacesAndNewlines).hasSuffix("?") else {
    return false
  }
  let agents = room?.members.filter { $0.kind != .human && $0.leftAt == nil }.map(\.name)
  return agents == [message.from]
}

private func content(room: String, from: String, text: String, muted: Set<String>) -> NotificationContent? {
  guard !muted.contains(room) else { return nil }
  let body = "\(from): \(text)"
  let cut = body.count > bodyLimit ? body.prefix(bodyLimit - 1) + "…" : body
  return NotificationContent(room: room, title: "#\(room)", body: String(cut))
}
