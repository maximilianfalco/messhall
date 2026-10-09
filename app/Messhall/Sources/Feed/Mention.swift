import Foundation

/// The mention that reaches every member of a room.
public let allMention = "all"

// The daemon's rule from src/rooms/rules.ts, with its ASCII `\w` spelled out since ICU's `\w` takes any letter.
private let mentionPattern = "(?<![A-Za-z0-9_.+-])@([a-z0-9-]{1,40})(?![a-z0-9-])"
let mentionRegex = try! NSRegularExpression(pattern: mentionPattern)
private let trailing = try! NSRegularExpression(pattern: "(?<![A-Za-z0-9_.+-])@([a-z0-9-]{0,40})$")

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

/// The name the picker marks: the one moved to while it still matches, else the first.
public func pickedMention(_ highlight: String?, in candidates: [String]) -> String? {
  candidates.contains { $0 == highlight } ? highlight : candidates.first
}

/// The name one step up or down from the marked one, wrapping at both ends.
public func steppedMention(from picked: String, by step: Int, in candidates: [String]) -> String? {
  guard let index = candidates.firstIndex(of: picked) else { return nil }
  return candidates[(index + step + candidates.count) % candidates.count]
}

/// True when the draft holds mentions and nothing else, so sending it would ring agents with no message.
public func onlyMentions(_ draft: String) -> Bool {
  let ns = draft as NSString
  let rest = mentionRegex.stringByReplacingMatches(in: draft, range: NSRange(location: 0, length: ns.length), withTemplate: "")
  return rest.count < draft.count && rest.allSatisfy(\.isWhitespace)
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
