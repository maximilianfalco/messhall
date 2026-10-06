import AppKit
import Feed
import SwiftUI

struct MenuBarLabel: View {
  let store: FeedStore
  let navigation: Navigation
  @Environment(\.openWindow) private var openWindow

  var body: some View {
    // The app delegate has no openWindow, and a closed window is gone from NSApp, so it asks here.
    Image(nsImage: StatusIcon.image(dot: store.anyActive))
      .onChange(of: navigation.windowRequests) { openWindow(id: MesshallApp.windowID) }
    if store.loaded { Text("\(store.openRoomCount)") }
  }
}

struct MenuBarMenu: View {
  let store: FeedStore
  let navigation: Navigation
  @Environment(\.openWindow) private var openWindow
  @Environment(\.openSettings) private var openSettings

  private var openRooms: [SnapshotRoom] { store.rooms.filter(\.isOpen) }

  var body: some View {
    Text(status)
    Divider()
    ForEach(openRooms) { room in
      Button("#\(room.name)  \(room.agentSummary)") { show(room.name) }
    }
    if !openRooms.isEmpty { Divider() }
    Button("Open Messhall") { show(nil) }
      .keyboardShortcut(AppSettings.shared.snapshot.hotkey.shortcut)
    Button("Settings\u{2026}") {
      openSettings()
      NSApp.activate()
    }
    Divider()
    Button("Quit Messhall") { NSApp.terminate(nil) }
  }

  private var status: String {
    if case .down(let reason) = store.phase, !store.loaded { return reason }
    if store.phase == .outdated, !store.loaded { return FeedStore.outdatedReason }
    let active = store.rooms.flatMap(\.liveAgents).filter { $0.presence == .active }.count
    return "\(plural(store.openRoomCount, "room")) open, \(active) active"
  }

  private func show(_ room: String?) {
    if let room { navigation.room = room }
    openWindow(id: MesshallApp.windowID)
    NSApp.activate()
  }
}

/// The menu bar symbol, with a dot cut into its corner while an agent is active.
enum StatusIcon {
  static func image(dot: Bool) -> NSImage {
    let size = NSSize(width: 20, height: 16)
    let image = NSImage(size: size, flipped: false) { rect in
      let config = NSImage.SymbolConfiguration(pointSize: 13, weight: .regular)
      let symbol = NSImage(systemSymbolName: "bubble.left.and.bubble.right", accessibilityDescription: nil)?
        .withSymbolConfiguration(config)
      if let symbol {
        let origin = NSPoint(x: 0, y: (rect.height - symbol.size.height) / 2)
        symbol.draw(at: origin, from: .zero, operation: .sourceOver, fraction: 1)
      }
      guard dot else { return true }
      let ring = NSRect(x: rect.width - 8, y: rect.height - 8, width: 8, height: 8)
      NSGraphicsContext.current?.compositingOperation = .clear
      NSBezierPath(ovalIn: ring).fill()
      NSGraphicsContext.current?.compositingOperation = .sourceOver
      NSColor.black.setFill()
      NSBezierPath(ovalIn: ring.insetBy(dx: 1.5, dy: 1.5)).fill()
      return true
    }
    image.isTemplate = true
    image.accessibilityDescription = dot ? "Messhall, agents active" : "Messhall"
    return image
  }
}
