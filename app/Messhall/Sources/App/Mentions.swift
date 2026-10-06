import Feed
import SwiftUI

/// The chat text with each stored mention tinted: `@human` bold in the accent, `@all` in secondary, an agent in its hue.
@MainActor
func mentionText(_ message: Message) -> AttributedString {
  message.mentionRuns.reduce(into: AttributedString()) { text, run in
    switch run {
    case .text(let plain):
      text += AttributedString(plain)
    case .mention(let name):
      var tag = AttributedString("@\(name)")
      tag.font = .body.weight(name == humanName ? .bold : .semibold)
      switch name {
      case humanName: tag.foregroundColor = .accentColor
      case allMention: tag.foregroundColor = .secondary
      default: tag.backgroundColor = avatarColor(for: name).opacity(0.18)
      }
      text += tag
    }
  }
}

/// The list over the composer while the draft ends in `@`. A row click picks that name.
struct MentionPicker: View {
  let names: [String]
  let selected: String?
  let members: [Member]
  let pick: (String) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      ForEach(names, id: \.self) { name in
        Button { pick(name) } label: {
          HStack(spacing: 8) {
            if name == allMention {
              Image(systemName: "person.3.fill")
                .imageScale(.small)
                .foregroundStyle(.tint)
                .frame(width: 20, height: 20)
            } else {
              AvatarView(name: name, size: 20)
            }
            Text("@\(name)").fontWeight(.medium)
            Spacer(minLength: 12)
            Text(detail(for: name))
              .font(.caption)
              .foregroundStyle(.secondary)
          }
          .padding(.horizontal, 8)
          .padding(.vertical, 5)
          .background(
            name == selected ? Color.accentColor.opacity(0.18) : .clear, in: RoundedRectangle(cornerRadius: 6)
          )
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Mention \(name)")
        .accessibilityAddTraits(name == selected ? .isSelected : [])
      }
    }
    .padding(4)
    .frame(width: 260)
    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.separator))
    .shadow(color: .black.opacity(0.12), radius: 6, y: 2)
  }

  private func detail(for name: String) -> String {
    guard name != allMention else { return "Everyone here" }
    return members.first { $0.name == name }?.presence.label ?? ""
  }
}
