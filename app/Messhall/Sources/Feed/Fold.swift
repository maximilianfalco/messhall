import Foundation

/// One row of the transcript: a message, or a run of presence lines folded into one.
public enum TranscriptItem: Equatable, Identifiable, Sendable {
  case message(Message)
  case fold(Fold)

  /// A fold takes its first line's id, so it stays the same row as the run grows.
  public var id: Int {
    switch self {
    case .message(let message): message.id
    case .fold(let fold): fold.id
    }
  }
}

/// Two or more presence lines in a row. `startsOpen` holds for the newest run while it is short.
public struct Fold: Equatable, Sendable {
  public var messages: [Message]
  public var startsOpen: Bool

  public var id: Int { messages[0].id }
}

/// The newest run shows its lines while it has fewer than this many.
public let foldOpenBelow = 3

// Rooms from before seats persisted still hold "is gone" lines.
private let presenceEndings = [" joined", " reconnected", " left", " is away", " is gone"]

extension Message {
  /// A joined, left, away or reconnected line. Room lines are not, so they never fold.
  public var isPresence: Bool {
    guard kind == .system, !text.hasPrefix("#") else { return false }
    return presenceEndings.contains { text.hasSuffix($0) } || text.contains(" left: ")
  }
}

extension Array where Element == Message {
  /// Folds each run of two or more presence lines. Any other line breaks the run and stays as is.
  public func folded() -> [TranscriptItem] {
    var items: [TranscriptItem] = []
    var run: [Message] = []
    func flush(newest: Bool) {
      if run.count == 1 { items.append(.message(run[0])) }
      if run.count > 1 { items.append(.fold(Fold(messages: run, startsOpen: newest && run.count < foldOpenBelow))) }
      run = []
    }
    for message in self {
      if message.isPresence {
        run.append(message)
        continue
      }
      flush(newest: false)
      items.append(.message(message))
    }
    flush(newest: true)
    return items
  }
}
