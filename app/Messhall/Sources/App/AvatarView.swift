import AppKit
import Feed
import SwiftUI

private let eyeSpreads = [0.14, 0.2, 0.26]

/// A colored circle with a face or a bundled picture, or the member's initials.
/// The human gets the accent color and a person glyph.
/// The human reads `.tint`, so the accent picked in Settings shows there too.
/// With a presence, a dot sits on the circle's corner.
struct AvatarView: View {
  let name: String
  var size = 28.0
  var presence: Presence?

  private var isHuman: Bool { name == humanName }
  private var style: AvatarStyle { AppSettings.shared.snapshot.avatarStyle }

  var body: some View {
    Circle()
      .fill(isHuman ? AnyShapeStyle(.tint) : AnyShapeStyle(avatarColor(for: name)))
      .overlay {
        if isHuman {
          Image(systemName: MemberKind.human.symbol)
            .font(.system(size: size * 0.5))
        } else if style == .face {
          FaceView(name: name)
        } else if let art = AvatarArt.image(for: name, style: style) {
          Image(nsImage: art)
            .resizable()
            .renderingMode(style == .notionists ? .template : .original)
            .scaledToFit()
            .clipShape(Circle())
        } else {
          Text(avatarLabel(for: name))
            .font(.system(size: size * (avatarLabel(for: name).count > 1 ? 0.4 : 0.5), weight: .semibold))
        }
      }
      .foregroundStyle(isHuman ? .white : Color(avatarInk(on: avatarRGB(for: name))))
      .frame(width: size, height: size)
      .overlay(alignment: .bottomTrailing) {
        if let presence {
          PresenceBadge(presence: presence)
            .offset(x: 2, y: 2)
        }
      }
      .accessibilityHidden(true)
  }
}

/// The bundled pictures, read once each. A missing file falls back to initials.
@MainActor
enum AvatarArt {
  private static var cache: [URL: NSImage] = [:]

  static func image(for name: String, style: AvatarStyle) -> NSImage? {
    guard let folder = style.artFolder, let root = Bundle.main.resourceURL else { return nil }
    let url = root.appendingPathComponent("Avatars/\(folder)/\(avatarArtFile(avatarArt(for: name)))")
    if let image = cache[url] { return image }
    guard let image = NSImage(contentsOf: url) else { return nil }
    cache[url] = image
    return image
  }
}

/// Two eyes and a mouth in unit space, drawn in the foreground style the circle sets.
struct FaceView: View {
  let name: String

  var body: some View {
    let face = avatarFace(for: name)
    Canvas { context, size in
      let w = size.width
      let spread = eyeSpreads[face.eyeSpread]
      for x in [0.5 - spread, 0.5 + spread] {
        let eye = CGRect(x: (x - 0.06) * w, y: 0.36 * w, width: 0.12 * w, height: 0.12 * w)
        context.fill(Path(ellipseIn: eye), with: .foreground)
      }
      let stroke = StrokeStyle(lineWidth: 0.05 * w, lineCap: .round)
      switch face.mouth {
      case 0:
        context.stroke(
          Path { p in
            p.move(to: CGPoint(x: 0.34 * w, y: 0.6 * w))
            p.addQuadCurve(to: CGPoint(x: 0.66 * w, y: 0.6 * w), control: CGPoint(x: 0.5 * w, y: 0.76 * w))
          }, with: .foreground, style: stroke)
      case 1:
        context.stroke(
          Path { p in
            p.move(to: CGPoint(x: 0.37 * w, y: 0.66 * w))
            p.addLine(to: CGPoint(x: 0.63 * w, y: 0.66 * w))
          }, with: .foreground, style: stroke)
      default:
        let open = CGRect(x: 0.42 * w, y: 0.6 * w, width: 0.16 * w, height: 0.12 * w)
        context.fill(Path(ellipseIn: open), with: .foreground)
      }
    }
  }
}

/// The presence dot on an avatar's corner, ringed in the window color so it reads on any fill.
struct PresenceBadge: View {
  let presence: Presence

  var body: some View {
    PresenceDot(presence: presence)
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
