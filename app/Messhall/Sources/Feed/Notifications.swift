import Foundation

let systemName = "messhall"
// Matches the daemon's line when the human closes a room, so your own close stays quiet.
let humanCloseSuffix = "closed by the human"
let bodyLimit = 120

let optionPrefix = "option."

/// One banner to show: the room it opens, its title and its body.
/// A question's banner also carries its id and the options it offers as buttons.
public struct NotificationContent: Equatable, Sendable {
  public let room: String
  public let title: String
  public let body: String
  public var questionId: String? = nil
  public var options: [String] = []
}

/// The banner category for one question, so its buttons carry that question's own options.
public func questionCategory(_ questionId: String) -> String { "question.\(questionId)" }

public func optionAction(_ index: Int) -> String { "\(optionPrefix)\(index)" }

/// The option index a banner button stands for, or nil for any other action.
public func optionIndex(of action: String) -> Int? {
  guard action.hasPrefix(optionPrefix) else { return nil }
  return Int(action.dropFirst(optionPrefix.count))
}

/// The question whose banner should go, because it is no longer open.
public func bannerToClear(for event: BusEvent) -> String? {
  guard case .question(let e) = event, e.question.state != .open else { return nil }
  return e.question.id
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
/// only agent in the room, a room that closes, a new tool ask or a new question. Never for the human's own posts.
public func notificationFor(event: BusEvent, state: NotifyState) -> NotificationContent? {
  guard state.enabled else { return nil }
  switch event {
  case .message(let e):
    guard isLive(e.message.createdAt, since: state.liveSince), wants(e.message, in: state.room) else { return nil }
    return content(room: e.room, body: "\(e.message.from): \(e.message.text)", muted: state.mutedRooms)
  case .room(let e):
    guard e.change == .closed, let closedAt = e.room.closedAt, isLive(closedAt, since: state.liveSince) else {
      return nil
    }
    let line = state.room?.messages.last { $0.kind == .system }?.text ?? "room closed"
    guard !line.hasSuffix(humanCloseSuffix) else { return nil }
    return content(room: e.room.name, body: "\(systemName): \(line)", muted: state.mutedRooms)
  case .approval(let e):
    let ask = e.approval
    guard ask.state == .pending, isLive(ask.createdAt, since: state.liveSince) else { return nil }
    return content(room: e.room, body: "\(ask.member) asks to use \(ask.tool): \(ask.description)", muted: state.mutedRooms)
  case .question(let e):
    let ask = e.question
    guard ask.state == .open, isLive(ask.createdAt, since: state.liveSince),
      var note = content(room: e.room, body: "\(ask.member) asks you: \(ask.question)", muted: state.mutedRooms)
    else { return nil }
    note.questionId = ask.id
    note.options = ask.options
    return note
  case .messageEdit, .member, .presence, .agreement, .unknown:
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

private func content(room: String, body: String, muted: Set<String>) -> NotificationContent? {
  guard !muted.contains(room) else { return nil }
  let cut = body.count > bodyLimit ? body.prefix(bodyLimit - 1) + "…" : body
  return NotificationContent(room: room, title: "#\(room)", body: String(cut))
}
