import Feed
import SwiftUI

/// A colored circle with the member's initials. The human gets the accent color and a person glyph.
/// The human reads `.tint`, so the accent picked in Settings shows there too.
struct AvatarView: View {
  let name: String
  var size = 28.0

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
      .accessibilityHidden(true)
  }
}
