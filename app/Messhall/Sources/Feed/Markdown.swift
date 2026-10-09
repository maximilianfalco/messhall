import Foundation

// A backtick fence's info has no backtick, so ```ls``` at a line start stays inline code.
private let fenceOpen = try! NSRegularExpression(pattern: "^( {0,3})(`{3,}|~{3,})[ \\t]*([^`]*)$")
private let safeSchemes: Set<String> = ["http", "https", "mailto"]
private let headingLine = try! NSRegularExpression(pattern: "^ {0,3}(#{1,6})[ \\t]+(.*?)[ \\t]*$")
private let listLine = try! NSRegularExpression(pattern: "^([ \\t]*)([-*+]|\\d{1,9}[.)])[ \\t]+(.*)$")
private let inlineOptions = AttributedString.MarkdownParsingOptions(
  interpretedSyntax: .inlineOnlyPreservingWhitespace, failurePolicy: .returnPartiallyParsedIfPossible)

/// Marks a run that is a mention the daemon stored on the message, with the name as its value.
public enum MentionAttribute: AttributedStringKey {
  public typealias Value = String
  public static let name = "dev.messhall.mention"
}

/// One list line: its marker (`•` or `3.`), how deep it sits, and its text.
public struct MarkdownItem: Equatable, Sendable {
  public var marker: String
  public var depth: Int
  public var text: AttributedString
}

/// One block of a message. Inline text carries Foundation's markdown intents and the mention mark.
public enum MarkdownBlock: Equatable, Sendable {
  case text(AttributedString)
  case heading(level: Int, AttributedString)
  case list([MarkdownItem])
  case code(language: String?, String)
}

extension Message {
  /// The text split into markdown blocks, with stored mentions marked outside code.
  public var markdownBlocks: [MarkdownBlock] {
    var builder = MarkdownBuilder(mentions: Set(mentions))
    for line in text.components(separatedBy: "\n") { builder.add(line) }
    return builder.finish()
  }
}

/// Each message parsed once, kept by id until its text or mentions change, so a row body never parses.
/// It empties past `limit` entries, so a long session across many rooms cannot grow it without end.
@MainActor
public final class MarkdownCache {
  public static let shared = MarkdownCache()
  private let limit: Int
  private var parsed: [Int: (text: String, mentions: [String], blocks: [MarkdownBlock])] = [:]

  public init(limit: Int = 2_000) { self.limit = limit }

  var count: Int { parsed.count }

  public func blocks(for message: Message) -> [MarkdownBlock] {
    if let hit = parsed[message.id], hit.text == message.text, hit.mentions == message.mentions { return hit.blocks }
    let blocks = message.markdownBlocks
    if parsed[message.id] == nil, parsed.count >= limit { parsed.removeAll() }
    parsed[message.id] = (message.text, message.mentions, blocks)
    return blocks
  }
}

private struct OpenFence {
  let marker: String
  let indent: Int
  let language: String?
  var lines: [String] = []

  func closes(_ line: String) -> Bool {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    let lead = line.prefix { $0 == " " }.count
    return lead <= 3 && trimmed.count >= marker.count && trimmed.allSatisfy { $0 == marker.first }
  }
}

private struct MarkdownBuilder {
  let mentions: Set<String>
  var blocks: [MarkdownBlock] = []
  var paragraph: [String] = []
  var items: [(marker: String, depth: Int, lines: [String])] = []
  var indents: [Int] = []
  var fence: OpenFence?

  mutating func add(_ line: String) {
    if var open = fence {
      if open.closes(line) {
        blocks.append(.code(language: open.language, open.lines.joined(separator: "\n")))
        fence = nil
      } else {
        open.lines.append(String(line.dropFirst(min(open.indent, line.prefix { $0 == " " }.count))))
        fence = open
      }
      return
    }
    if let groups = match(fenceOpen, line) {
      flush()
      let language = groups[2].split(whereSeparator: \.isWhitespace).first.map(String.init)
      fence = OpenFence(marker: groups[1], indent: groups[0].count, language: language)
      return
    }
    if line.allSatisfy(\.isWhitespace) { return flush() }
    if let groups = match(headingLine, line) {
      flush()
      blocks.append(.heading(level: groups[0].count, inline(groups[1])))
      return
    }
    if let groups = match(listLine, line) { return addItem(indent: groups[0], marker: groups[1], text: groups[2]) }
    if !items.isEmpty, line.first?.isWhitespace == true {
      items[items.count - 1].lines.append(line.trimmingCharacters(in: .whitespaces))
      return
    }
    flushList()
    paragraph.append(line)
  }

  mutating func finish() -> [MarkdownBlock] {
    if let open = fence { blocks.append(.code(language: open.language, open.lines.joined(separator: "\n"))) }
    flush()
    return blocks
  }

  private mutating func addItem(indent: String, marker: String, text: String) {
    flushParagraph()
    let width = indent.reduce(0) { $0 + ($1 == "\t" ? 4 : 1) }
    while let last = indents.last, width < last { indents.removeLast() }
    if indents.last.map({ width > $0 }) ?? true { indents.append(width) }
    let shown = marker.first?.isNumber == true ? "\(marker.dropLast())." : "•"
    items.append((shown, indents.count - 1, [text]))
  }

  private mutating func flush() {
    flushParagraph()
    flushList()
  }

  private mutating func flushParagraph() {
    guard !paragraph.isEmpty else { return }
    blocks.append(.text(inline(paragraph.joined(separator: "\n"))))
    paragraph = []
  }

  private mutating func flushList() {
    guard !items.isEmpty else { return }
    blocks.append(
      .list(items.map { MarkdownItem(marker: $0.marker, depth: $0.depth, text: inline($0.lines.joined(separator: "\n"))) }))
    items = []
    indents = []
  }

  private func inline(_ source: String) -> AttributedString {
    var text = (try? AttributedString(markdown: source, options: inlineOptions)) ?? AttributedString(source)
    // The app has no openURL handler, so a file: or custom scheme link would open an app or a file on click.
    for run in text.runs {
      guard let link = run.link, !safeSchemes.contains(link.scheme?.lowercased() ?? "") else { continue }
      text[run.range].link = nil
    }
    let plain = String(text.characters)
    let ns = plain as NSString
    for found in mentionRegex.matches(in: plain, range: NSRange(location: 0, length: ns.length)) {
      let name = ns.substring(with: found.range(at: 1))
      guard mentions.contains(name), let range = Range(found.range, in: plain) else { continue }
      let lower = text.characters.index(text.startIndex, offsetBy: plain.distance(from: plain.startIndex, to: range.lowerBound))
      let upper = text.characters.index(lower, offsetBy: plain.distance(from: range.lowerBound, to: range.upperBound))
      guard !text[lower..<upper].runs.contains(where: { $0.inlinePresentationIntent?.contains(.code) == true }) else {
        continue
      }
      text[lower..<upper][MentionAttribute.self] = name
    }
    return text
  }
}

/// The capture groups of the first match of `regex` in `line`, or nil when it does not match.
private func match(_ regex: NSRegularExpression, _ line: String) -> [String]? {
  let ns = line as NSString
  guard let found = regex.firstMatch(in: line, range: NSRange(location: 0, length: ns.length)) else { return nil }
  return (1..<found.numberOfRanges).map {
    found.range(at: $0).location == NSNotFound ? "" : ns.substring(with: found.range(at: $0))
  }
}
