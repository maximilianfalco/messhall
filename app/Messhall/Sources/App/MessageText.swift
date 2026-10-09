import Feed
import SwiftUI

/// A chat line's text as markdown. Mentions are tinted here, not in the cache, since a member's color can change.
struct MessageText: View {
  let message: Message
  let trailing: Bool

  var body: some View {
    let blocks = MarkdownCache.shared.blocks(for: message)
    VStack(alignment: trailing ? .trailing : .leading, spacing: 6) {
      ForEach(blocks.indices, id: \.self) { block(blocks[$0]) }
    }
    .textSelection(.enabled)
    .fixedSize(horizontal: false, vertical: true)
  }

  @ViewBuilder private func block(_ block: MarkdownBlock) -> some View {
    switch block {
    case .text(let text):
      Text(tinted(text, base: .body))
        .multilineTextAlignment(trailing ? .trailing : .leading)
    case .heading(let level, let text):
      let font = headingFont(level)
      Text(tinted(text, base: font)).font(font)
    case .list(let items):
      MarkdownList(items: items)
    case .code(_, let code):
      CodeBlock(code: code)
    }
  }

  private func headingFont(_ level: Int) -> Font {
    switch level {
    case 1: .title2.bold()
    case 2: .title3.bold()
    default: .headline
    }
  }
}

private struct MarkdownList: View {
  let items: [MarkdownItem]

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      ForEach(items.indices, id: \.self) { index in
        let item = items[index]
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          Text(item.marker)
            .monospacedDigit()
            .foregroundStyle(.secondary)
          Text(tinted(item.text, base: .body))
        }
        .padding(.leading, CGFloat(item.depth) * 18)
      }
    }
  }
}

/// A fenced block: monospace on its own background, whitespace kept. A long line wraps, since a scroll view per block slowed fast scrolls.
private struct CodeBlock: View {
  let code: String
  @State private var hovering = false
  @State private var copied = false

  var body: some View {
    Text(code)
      .font(.system(.callout, design: .monospaced))
      .padding(.horizontal, 10)
      .padding(.vertical, 8)
      .padding(.trailing, 28)
      .frame(maxWidth: .infinity, alignment: .leading)
    .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 6))
    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.separator.opacity(0.6)))
    .overlay(alignment: .topTrailing) {
      if hovering || copied {
        Button(action: copy) {
          Image(systemName: copied ? "checkmark" : "doc.on.doc")
            .contentTransition(.symbolEffect(.replace))
            .frame(width: 22, height: 22)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 5))
        }
        .buttonStyle(.plain)
        .padding(4)
        .help(copied ? "Copied" : "Copy code")
        .accessibilityLabel(copied ? "Copied" : "Copy code")
      }
    }
    .onHover { hovering = $0 }
  }

  private func copy() {
    copyToPasteboard(code)
    copied = true
    Task {
      try? await Task.sleep(for: copiedFor)
      copied = false
    }
  }
}

/// The text with each stored mention tinted: `@human` bold in the accent, `@all` in secondary, an agent in its hue.
/// Inline code gets a soft background.
@MainActor
private func tinted(_ source: AttributedString, base: Font) -> AttributedString {
  var text = source
  for run in source.runs {
    if run.inlinePresentationIntent?.contains(.code) == true {
      text[run.range].backgroundColor = Color.secondary.opacity(0.15)
    }
    guard let name = run[MentionAttribute.self] else { continue }
    text[run.range].font = base.weight(name == humanName ? .bold : .semibold)
    switch name {
    case humanName: text[run.range].foregroundColor = .accentColor
    case allMention: text[run.range].foregroundColor = .secondary
    default: text[run.range].backgroundColor = avatarColor(for: name).opacity(0.18)
    }
  }
  return text
}
