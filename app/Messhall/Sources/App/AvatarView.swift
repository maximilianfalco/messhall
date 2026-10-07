import Feed
import SwiftUI

/// A colored circle with the member's initials. The human gets the accent color and a person glyph.
/// The human reads `.tint`, so the accent picked in Settings shows there too.
/// With a presence, a dot sits on the circle's corner, and a check for a done agent.
struct AvatarView: View {
  let name: String
  var size = 28.0
  var presence: Presence?
  var done = false

  private var isHuman: Bool { name == humanName }

  var body: some View {
    Circle()
      .fill(isHuman ? AnyShapeStyle(.tint) : AnyShapeStyle(avatarColor(for: name)))
      .overlay {
        if isHuman {
          Image(systemName: MemberKind.human.symbol)
            .font(.system(size: size * 0.5))
        } else {
          Text(avatarLabel(for: name))
            .font(.system(size: size * (avatarLabel(for: name).count > 1 ? 0.4 : 0.5), weight: .semibold))
        }
      }
      .foregroundStyle(isHuman ? .white : Color(avatarInk(on: avatarRGB(for: name))))
      .frame(width: size, height: size)
      .overlay(alignment: .bottomTrailing) {
        if let presence {
          PresenceBadge(presence: presence, done: done)
            .offset(x: 2, y: 2)
        }
      }
      .accessibilityHidden(true)
  }
}

/// The presence dot on an avatar's corner, ringed in the window color so it reads on any fill.
/// A done agent gets a check instead.
struct PresenceBadge: View {
  let presence: Presence
  let done: Bool

  var body: some View {
    Group {
      if done {
        Image(systemName: "checkmark.circle.fill")
          .font(.system(size: 9, weight: .bold))
          .foregroundStyle(.white, .green)
      } else {
        PresenceDot(presence: presence)
      }
    }
    .padding(1.5)
    .background(.background, in: Circle())
  }
}

struct PresenceDot: View {
  let presence: Presence

  var body: some View {
    Group {
      if presence.isAway {
        Circle().strokeBorder(presence.color, lineWidth: 1.5)
      } else {
        Circle().fill(presence.color)
      }
    }
    .frame(width: 8, height: 8)
  }
}
