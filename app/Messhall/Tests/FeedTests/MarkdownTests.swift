import Foundation
import Testing

@testable import Feed

@Suite("Markdown")
struct MarkdownTests {
  private func blocks(_ text: String, mentions: [String] = []) -> [MarkdownBlock] {
    Message(
      id: 1, roomId: "r1", from: "api", kind: .chat, text: text, mentions: mentions,
      createdAt: "2026-01-01T09:00:00.000Z"
    ).markdownBlocks
  }

  private func plain(_ text: AttributedString) -> String { String(text.characters) }

  private func shape(_ block: MarkdownBlock) -> String {
    switch block {
    case .text(let text): "text:\(plain(text))"
    case .heading(let level, let text): "h\(level):\(plain(text))"
    case .code(let language, let code): "code(\(language ?? "")):\(code)"
    case .list(let items): "list:" + items.map { "\($0.depth)\($0.marker) \(plain($0.text))" }.joined(separator: "|")
    }
  }

  private func shapes(_ text: String) -> [String] { blocks(text).map(shape) }

  private func mentions(in text: AttributedString) -> [String] {
    text.runs.compactMap { $0[MentionAttribute.self] }
  }

  private func runs(_ text: AttributedString, with intent: InlinePresentationIntent) -> [String] {
    text.runs.filter { $0.inlinePresentationIntent?.contains(intent) == true }.map { String(text[$0.range].characters) }
  }

  private func onlyText(_ text: String, mentions: [String] = []) -> AttributedString {
    guard case .text(let line) = blocks(text, mentions: mentions).first else { return AttributedString() }
    return line
  }

  @Test("a line with no markdown is one text block, as written")
  func plainLine() {
    #expect(shapes("all good, tests green\nnext line") == ["text:all good, tests green\nnext line"])
  }

  @Test("a blank line starts a new text block")
  func paragraphs() {
    #expect(shapes("first\n\n\nsecond") == ["text:first", "text:second"])
  }

  @Test("a fenced block keeps its whitespace and its language")
  func fence() {
    let text = "the fix:\n```swift\nfunc a() {\n    b(  1 )\n}\n```\nthat is all"

    #expect(shapes(text) == ["text:the fix:", "code(swift):func a() {\n    b(  1 )\n}", "text:that is all"])
  }

  @Test("an unclosed fence runs to the end of the message")
  func openFence() {
    #expect(shapes("look\n```\nline one\n\nline two") == ["text:look", "code():line one\n\nline two"])
  }

  @Test("a tilde fence closes only on tildes, and an indented fence loses that indent")
  func otherFences() {
    #expect(shapes("~~~\n```\n~~~") == ["code():```"])
    #expect(shapes("  ```\n  a\n    b\n  ```") == ["code():a\n  b"])
  }

  @Test("markdown inside a fence stays literal")
  func fenceIsLiteral() {
    #expect(shapes("```\n# not a heading\n- not a list\n**x**\n```") == ["code():# not a heading\n- not a list\n**x**"])
  }

  @Test("headings take their level from the hashes")
  func headings() {
    #expect(shapes("# Plan\n### Step **one**\n#hashtag") == ["h1:Plan", "h3:Step one", "text:#hashtag"])
  }

  @Test("bullets and numbers become list items with depth and their own marker")
  func lists() {
    let text = "steps:\n- one\n* two\n  - nested\n1. first\n2) second\n10. tenth"

    #expect(
      shapes(text) == ["text:steps:", "list:0• one|0• two|1• nested|01. first|02. second|010. tenth"])
  }

  @Test("an indented line under an item carries on that item")
  func listContinuation() {
    #expect(shapes("- one\n  still one\n- two\nafter") == ["list:0• one\nstill one|0• two", "text:after"])
  }

  @Test("bold, italic, inline code and links are marked inline")
  func inline() {
    let line = onlyText("a **bold** and _it_ and `code` and [docs](https://example.com) and https://github.com/a/b")

    #expect(plain(line) == "a bold and it and code and docs and https://github.com/a/b")
    #expect(runs(line, with: .stronglyEmphasized) == ["bold"])
    #expect(runs(line, with: .emphasized) == ["it"])
    #expect(runs(line, with: .code) == ["code"])
    #expect(line.runs.compactMap(\.link) == [URL(string: "https://example.com")!, URL(string: "https://github.com/a/b")!])
  }

  @Test("snake case names and lone stars stay plain")
  func noFalseEmphasis() {
    let line = onlyText("amount_minor_units and 2 * 3 * 4")

    #expect(plain(line) == "amount_minor_units and 2 * 3 * 4")
    #expect(runs(line, with: .emphasized).isEmpty)
  }

  @Test("a stored mention is marked, a typo like @ghost is not")
  func storedMentions() {
    let line = onlyText("@web the schema moved, @all see #12 and @ghost", mentions: ["web", "all"])

    #expect(mentions(in: line) == ["web", "all"])
    #expect(plain(line) == "@web the schema moved, @all see #12 and @ghost")
  }

  @Test("an email or a longer name is never cut into a mention")
  func mentionLookalikes() {
    #expect(mentions(in: onlyText("mail dev@web or @web-2 now", mentions: ["web"])).isEmpty)
  }

  @Test("a mention inside inline code stays code")
  func mentionInCode() {
    let line = onlyText("ping @web, not `@web`", mentions: ["web"])

    #expect(mentions(in: line) == ["web"])
    #expect(runs(line, with: .code) == ["@web"])
  }

  @Test("mentions are marked in list items and headings too")
  func mentionsInBlocks() {
    let parsed = blocks("# for @web\n- @api do this", mentions: ["web", "api"])

    guard case .heading(_, let heading) = parsed.first, case .list(let items) = parsed.last else {
      Issue.record("wrong blocks \(parsed)")
      return
    }
    #expect(mentions(in: heading) == ["web"])
    #expect(mentions(in: items[0].text) == ["api"])
  }

  @Test("a line that starts with inline code in triple backticks is not a fence")
  func inlineTripleBackticks() {
    #expect(shapes("```ls``` lists files\nnext") == ["text:ls lists files\nnext"])
  }

  @Test("the language is the first word after the fence")
  func fenceLanguageWord() {
    #expect(shapes("```swift title=a\nx\n```") == ["code(swift):x"])
  }

  @Test("only http, https and mailto links stay links", arguments: [
    "[app](file:///Applications/Calculator.app)", "[run](javascript:alert(1))", "[x](messhall-custom://open)",
  ])
  func unsafeLinks(source: String) {
    #expect(onlyText(source).runs.compactMap(\.link).isEmpty)
  }

  @Test("safe links keep their url")
  func safeLinks() {
    let line = onlyText("[a](https://a.dev) [b](http://b.dev) [c](mailto:c@d.dev)")

    #expect(line.runs.compactMap(\.link).map(\.scheme) == ["https", "http", "mailto"])
  }

  @Test("the cache parses a message once and again after an edit")
  @MainActor
  func cacheHit() {
    let cache = MarkdownCache(limit: 10)
    var message = Message(
      id: 7, roomId: "r1", from: "api", kind: .chat, text: "**a**", mentions: [], createdAt: "t0")

    #expect(cache.blocks(for: message) == message.markdownBlocks)
    message.text = "**b**"
    #expect(cache.blocks(for: message) == message.markdownBlocks)
    #expect(cache.count == 1)
  }

  @Test("the cache empties once it passes its limit")
  @MainActor
  func cacheCap() {
    let cache = MarkdownCache(limit: 3)
    for id in 1...4 {
      _ = cache.blocks(
        for: Message(id: id, roomId: "r1", from: "api", kind: .chat, text: "line \(id)", mentions: [], createdAt: "t0"))
    }

    #expect(cache.count == 1)
  }
}
