#if DEBUG
  import AppKit
  import Feed
  import SwiftUI

  /// Debug-only launch hooks for `pnpm messhall-dev app-shot`, which cannot click a window or the menu bar.
  @MainActor
  enum ShotHooks {
    /// `-shotPost <text>`: posts into the first open room through the same path as the post box.
    static func post(_ text: String, store: FeedStore, client: FeedClient) async {
      while !store.loaded { try? await Task.sleep(for: .milliseconds(100)) }
      guard let room = store.rooms.first(where: \.isOpen) else { return }
      if let refusal = await store.post(text, room: room.name, via: client) {
        FileHandle.standardError.write(Data("shotPost refused: \(refusal)\n".utf8))
      }
    }

    /// `-renderStatus <dir>`: writes the menu bar label, idle and active, in light and dark.
    static func renderStatus(into dir: URL) {
      for scheme in [ColorScheme.light, .dark] {
        let view = HStack(spacing: 24) {
          StatusPreview(dot: false, count: 1)
          StatusPreview(dot: true, count: 2)
        }
        .padding(.horizontal, 14)
        .frame(height: 24)
        .background(scheme == .dark ? Color(white: 0.16) : Color(white: 0.93))
        .environment(\.colorScheme, scheme)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 4
        guard let image = renderer.nsImage, let tiff = image.tiffRepresentation,
          let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:])
        else { continue }
        try? png.write(to: dir.appendingPathComponent("menu-\(scheme == .dark ? "dark" : "light").png"))
      }
    }
  }

  private struct StatusPreview: View {
    let dot: Bool
    let count: Int

    var body: some View {
      HStack(spacing: 4) {
        Image(nsImage: StatusIcon.image(dot: dot)).renderingMode(.template)
        Text("\(count)").font(.system(size: 13))
      }
      .foregroundStyle(.primary)
    }
  }
#endif
