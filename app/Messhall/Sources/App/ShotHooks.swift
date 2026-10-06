#if DEBUG
  import AppKit
  import Feed
  import SwiftUI

  /// Debug-only launch hooks for `pnpm messhall-dev app-shot`, which cannot click a window or the menu bar.
  @MainActor
  enum ShotHooks {
    /// `-shotAppearance light|dark`: a launch arg cannot flip the system setting, so the app is set instead.
    static func forceAppearance(_ name: String?) {
      switch name {
      case "light": NSApp.appearance = NSAppearance(named: .aqua)
      case "dark": NSApp.appearance = NSAppearance(named: .darkAqua)
      default: break
      }
    }

    /// `-shotScrollTop YES`: the transcript opens at its first message, so a post shows the jump pill.
    static let startAtTop = UserDefaults.standard.bool(forKey: "shotScrollTop")

    /// `-shotPost <text>`: posts into the open room, or the first open one, through the same path as the post box.
    static func post(_ text: String, store: FeedStore, client: FeedClient, navigation: Navigation) async {
      while !store.loaded { try? await Task.sleep(for: .milliseconds(100)) }
      // Gives the window time to scroll to the top first.
      if startAtTop { try? await Task.sleep(for: .seconds(1)) }
      guard let room = store.room(named: navigation.room) ?? store.rooms.first(where: \.isOpen) else { return }
      if let refusal = await store.post(text, room: room.name, via: client) {
        FileHandle.standardError.write(Data("shotPost refused: \(refusal)\n".utf8))
      }
    }

    /// `-shotRoom <name>` opens that room. `-shotNewRoom <draft>` opens the New Room sheet with that name typed.
    static func navigate(room: String?, newRoom: String?, navigation: Navigation) {
      if let room { navigation.room = room }
      if let newRoom { navigation.newRoomDraft = newRoom }
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
