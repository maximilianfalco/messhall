import Foundation

/// The mention that reaches every member of a room.
public let allMention = "all"

// The daemon's rule from src/rooms/rules.ts, with its ASCII `\w` spelled out since ICU's `\w` takes any letter.
private let mentionPattern = "(?<![A-Za-z0-9_.+-])@([a-z0-9-]{1,40})(?![a-z0-9-])"
private let mention = try! NSRegularExpression(pattern: mentionPattern)
private let trailing = try! NSRegularExpression(pattern: "(?<![A-Za-z0-9_.+-])@([a-z0-9-]{0,40})$")

/// One piece of a chat line: plain text, or a mention the daemon stored on the message.
public enum MentionRun: Equatable, Sendable {
  case text(String)
  case mention(String)
}

extension Message {
  /// The text cut at each stored mention, so a typo like `@ghost` stays plain text.
  public var mentionRuns: [MentionRun] {
    let ns = text as NSString
    var runs: [MentionRun] = []
    var start = 0
    for match in mention.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
      let name = ns.substring(with: match.range(at: 1))
      guard mentions.contains(name) else { continue }
      if match.range.location > start {
        runs.append(.text(ns.substring(with: NSRange(location: start, length: match.range.location - start))))
      }
      runs.append(.mention(name))
      start = match.range.location + match.range.length
    }
    if start < ns.length { runs.append(.text(ns.substring(from: start))) }
    return runs
  }
}

/// The partial name after an `@` at the end of the draft, or nil when the draft does not end in one.
public func mentionQuery(in draft: String) -> String? {
  let ns = draft as NSString
  guard let match = trailing.firstMatch(in: draft, range: NSRange(location: 0, length: ns.length)) else { return nil }
  return ns.substring(with: match.range(at: 1))
}

/// Names the picker offers: members still here then `all`, never the human. Prefix matches go first.
public func mentionCandidates(query: String, members: [Member]) -> [String] {
  let names = members.filter { $0.presence != .left && $0.kind != .human }.map(\.name) + [allMention]
  guard !query.isEmpty else { return names }
  let matching = names.filter { $0.contains(query) }
  return matching.filter { $0.hasPrefix(query) } + matching.filter { !$0.hasPrefix(query) }
}

/// The draft with its trailing `@partial` swapped for `@name `.
public func completeMention(_ name: String, in draft: String) -> String {
  guard let query = mentionQuery(in: draft) else { return appendMention(name, to: draft) }
  return String(draft.dropLast(query.count + 1)) + "@\(name) "
}

/// The draft with `@name ` at the end, after a space unless it already ends in whitespace.
public func appendMention(_ name: String, to draft: String) -> String {
  let gap = draft.isEmpty || draft.last?.isWhitespace == true ? "" : " "
  return draft + gap + "@\(name) "
}
