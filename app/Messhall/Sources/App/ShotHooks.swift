#if DEBUG
  import AppKit
  import Feed
  import SwiftUI

  /// Debug-only launch hooks for `pnpm messhall-dev app-shot`, which cannot click a window or the menu bar.
  @MainActor
  enum ShotHooks {
    /// True when app-shot launched this copy. It then runs with no Dock icon and never takes focus.
    static let isShot = CommandLine.arguments.contains { $0.hasPrefix("-shot") || $0 == "-renderStatus" }

    /// `-shotAppearance light|dark`: a launch arg cannot flip the system setting, so the app is set instead.
    static func forceAppearance(_ name: String?) {
      name.flatMap(AppearanceChoice.init(rawValue:))?.apply()
    }

    /// `-shotScrollTop YES`: the transcript opens at its first message, so an agent post shows the jump pill.
    static let startAtTop = UserDefaults.standard.bool(forKey: "shotScrollTop")

    /// `-shotPageTop <file>`: scrolls the transcript to the top so an older page loads, then notes in the file
    /// where the anchor row sat before and after, and shows the oldest lines.
    static let pageTopNote = UserDefaults.standard.string(forKey: "shotPageTop")

    /// `-shotOpenFolds YES`: every run of presence lines starts open, so a shot shows the lines inside.
    static let openFolds = UserDefaults.standard.bool(forKey: "shotOpenFolds")

    /// `-shotDraft <text>`: the composer opens with this typed, so a draft ending in `@` shows the mention picker.
    static let draft = UserDefaults.standard.string(forKey: "shotDraft")

    /// `-shotKeys <steps>`: steps split by `|`, each `down`, `up`, `return`, `tab`, `escape` or text to type.
    /// The app sends them to its own composer, so the real app never gets a key. After each step the field goes to `-shotKeysOut`.
    static func pressKeys(_ steps: String, logTo file: String) async {
      while NSApp.windows.first(where: isPlain) == nil { try? await Task.sleep(for: .milliseconds(100)) }
      try? await Task.sleep(for: .seconds(2))
      guard let window = NSApp.windows.first(where: isPlain), let field = window.contentView.flatMap(composer) else {
        return
      }
      window.makeKey()
      window.makeFirstResponder(field)
      var log = "start: [\(fieldText(window))]\n"
      for step in steps.split(separator: "|").map(String.init) {
        for event in keyEvents(step, in: window) { window.sendEvent(event) }
        try? await Task.sleep(for: .milliseconds(400))
        log += "\(step): [\(fieldText(window))]\n"
      }
      try? log.write(toFile: file, atomically: true, encoding: .utf8)
    }

    private static let namedKeys: [String: (code: UInt16, chars: String)] = [
      "down": (125, String(UnicodeScalar(NSDownArrowFunctionKey)!)),
      "up": (126, String(UnicodeScalar(NSUpArrowFunctionKey)!)),
      "return": (36, "\r"), "tab": (48, "\t"), "escape": (53, "\u{1b}"),
    ]

    private static func keyEvents(_ step: String, in window: NSWindow) -> [NSEvent] {
      let keys = namedKeys[step].map { [$0] } ?? step.map { (code: UInt16(0), chars: String($0)) }
      return keys.flatMap { key in
        [NSEvent.EventType.keyDown, .keyUp].compactMap {
          NSEvent.keyEvent(
            with: $0, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: window.windowNumber, context: nil, characters: key.chars,
            charactersIgnoringModifiers: key.chars, isARepeat: false, keyCode: key.code)
        }
      }
    }

    private static func composer(in view: NSView) -> NSView? {
      if let text = view as? NSTextView, text.isEditable { return text }
      if let field = view as? NSTextField, field.isEditable, !(field is NSSearchField) { return field }
      return view.subviews.lazy.compactMap(composer).first
    }

    private static func fieldText(_ window: NSWindow) -> String {
      (window.firstResponder as? NSTextView)?.string ?? "?"
    }

    /// `-shotPost <text>`: posts into the first open room through the same path as the post box.
    static func post(_ text: String, store: FeedStore, client: FeedClient) async {
      while !store.loaded { try? await Task.sleep(for: .milliseconds(100)) }
      guard let room = store.rooms.first(where: \.isOpen) else { return }
      if let refusal = await store.post(text, room: room.name, via: client) {
        FileHandle.standardError.write(Data("shotPost refused: \(refusal)\n".utf8))
      }
    }

    /// `-shotRole <member>=<role>`: sets a role in the `-shotRoom` room through the same path as the role menu.
    static func setRole(_ spec: String, room: String?, store: FeedStore, client: FeedClient) async {
      let parts = spec.split(separator: "=").map(String.init)
      guard let room, parts.count == 2 else { return }
      while !store.loaded { try? await Task.sleep(for: .milliseconds(100)) }
      if let refusal = await store.setRole(parts[1], member: parts[0], room: room, via: client) {
        FileHandle.standardError.write(Data("shotRole refused: \(refusal)\n".utf8))
      }
    }

    /// `-shotRoom <name>` opens that room. `-shotNewRoom <draft>` opens the New Room sheet with that name typed.
    static func navigate(room: String?, newRoom: String?, navigation: Navigation) {
      if let room { navigation.room = room }
      if let newRoom { navigation.newRoomDraft = newRoom }
    }

    /// `-shotSheet <file>`: draws the open sheet into a png from inside the app.
    /// screencapture cannot grab a window with a sheet on an accessory app, so app-shot reads this file instead.
    static func saveSheet(to file: String) async {
      while NSApp.windows.first(where: { $0.sheetParent != nil && $0.isVisible }) == nil {
        try? await Task.sleep(for: .milliseconds(100))
      }
      try? await Task.sleep(for: .seconds(1))
      guard let view = NSApp.windows.first(where: { $0.sheetParent != nil })?.contentView?.superview,
        let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds)
      else { return }
      view.cacheDisplay(in: view.bounds, to: rep)
      try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: file))
    }

    /// `-shotSettings <file>`: picks Settings in the app menu, like cmd comma, and writes its window number.
    /// The main window stays in the window list after a close, so app-shot needs the number to find Settings.
    static func openSettings(numberInto file: String) async {
      while NSApp.windows.first(where: isPlain) == nil { try? await Task.sleep(for: .milliseconds(100)) }
      let main = NSApp.windows.first(where: isPlain)
      guard let menu = NSApp.mainMenu?.items.first?.submenu,
        let index = menu.items.firstIndex(where: { $0.keyEquivalent == "," })
      else { return }
      menu.performActionForItem(at: index)
      while NSApp.windows.first(where: { $0 !== main && isPlain($0) }) == nil {
        try? await Task.sleep(for: .milliseconds(100))
      }
      let settings = NSApp.windows.first { $0 !== main && isPlain($0) }
      try? String(settings?.windowNumber ?? 0).write(toFile: file, atomically: true, encoding: .utf8)
    }

    private static func isPlain(_ window: NSWindow) -> Bool {
      window.isVisible && window.styleMask.contains(.titled) && window.sheetParent == nil
    }

    /// `-shotToggleSidebar <seconds>`: hides then shows the sidebar, the same call as View > Hide Sidebar.
    static func toggleSidebar(pause: Double) async {
      while splitController() == nil { try? await Task.sleep(for: .milliseconds(100)) }
      // A window covered or on another Space draws only a few frames a second.
      // So the take floats it on top of the Space in use, still without focus.
      let window = splitController()?.view.window
      window?.collectionBehavior.formUnion([.canJoinAllSpaces, .fullScreenAuxiliary])
      window?.level = .floating
      window?.orderFrontRegardless()
      for _ in 0..<2 {
        try? await Task.sleep(for: .seconds(pause))
        splitController()?.toggleSidebar(nil)
      }
    }

    /// SwiftUI keeps its split view controller off the window's controller tree, so it is found by its view.
    private static func splitController() -> NSSplitViewController? {
      func find(_ view: NSView) -> NSSplitView? {
        view as? NSSplitView ?? view.subviews.lazy.compactMap(find).first
      }
      return NSApp.windows.first(where: isPlain)?.contentView.flatMap(find)?.delegate as? NSSplitViewController
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
