import AppKit
import Feed
import SwiftUI
import UserNotifications

@Observable
@MainActor
final class Navigation {
  var room: String?
  /// The name the New Room sheet starts with. Nil while the sheet is shut.
  var newRoomDraft: String?
  /// Bumped to ask the menu bar label, which always lives, to open the window.
  var windowRequests = 0
  var showsAgents = Navigation.startsWithAgents
  /// The post the transcript scrolls to, set by a click on an agent in the Agents panel.
  var revealed: Reveal?

  #if DEBUG
    private static let startsWithAgents = ShotHooks.showsAgents
  #else
    private static let startsWithAgents = false
  #endif

  /// Opens the agent's room at its last post. An agent with no loaded post opens at the end.
  func reveal(_ agent: AgentRow) {
    room = agent.room
    revealed = agent.lastPost.map { Reveal(room: agent.room, messageId: $0.id) }
  }
}

/// A post to scroll to. Each click makes a new one, so a second click on the same agent scrolls again.
struct Reveal: Equatable {
  let room: String
  let messageId: Int
  let id = UUID()
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
  let store = FeedStore()
  let client = FeedClient()
  let navigation = Navigation()
  let settings = AppSettings.shared
  lazy var notifier = Notifier(settings: settings)
  lazy var hotkey = GlobalHotkey { [unowned self] in show(nil) }
  let pullRequests = PullRequestStore(read: AppDelegate.readPullRequest())

  private static func readPullRequest() -> PullRequestStore.Read {
    #if DEBUG
      if let json = ShotHooks.pullRequests {
        let read = ShotHooks.readPullRequest(from: json)
        return { link in
          PerfHooks.pullRequestReads += 1
          return await read(link)
        }
      }
    #endif
    return Feed.readPullRequest
  }

  func applicationWillFinishLaunching(_ notification: Notification) {
    UNUserNotificationCenter.current().delegate = self
    settings.snapshot.appearance.apply()
    #if DEBUG
      if ShotHooks.isShot { NSApp.setActivationPolicy(.accessory) }
      if let dir = UserDefaults.standard.string(forKey: "renderStatus") {
        ShotHooks.renderStatus(into: URL(fileURLWithPath: dir))
        exit(0)
      }
      ShotHooks.forceAppearance(UserDefaults.standard.string(forKey: "shotAppearance"))
    #endif
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    Task { await notifier.requestPermission() }
    store.onEvent = { [notifier, unowned store] event, room in
      notifier.notify(event, room: room, liveSince: store.liveSince)
    }
    #if DEBUG
      if let contract = UserDefaults.standard.string(forKey: "shotContract").flatMap(Int.init) {
        store.builtContract = contract
      }
    #endif
    Task { await store.run(client) }
    trackThinking()
    trackVisibility()
    #if DEBUG
      // A shot app must not take the real app's keys.
      if !ShotHooks.isShot { trackHotkey() }
      if let text = UserDefaults.standard.string(forKey: "shotPost") {
        Task { await ShotHooks.post(text, store: store, client: client) }
      }
      if let role = UserDefaults.standard.string(forKey: "shotRole") {
        let room = UserDefaults.standard.string(forKey: "shotRoom")
        Task { await ShotHooks.setRole(role, room: room, store: store, client: client) }
      }
      if let member = UserDefaults.standard.string(forKey: "shotRemove") {
        let room = UserDefaults.standard.string(forKey: "shotRoom")
        Task { await ShotHooks.remove(member, room: room, store: store, client: client) }
      }
      if let member = UserDefaults.standard.string(forKey: "shotMute") {
        let room = UserDefaults.standard.string(forKey: "shotRoom")
        Task { await ShotHooks.mute(member, room: room, store: store, client: client) }
      }
      ShotHooks.navigate(
        room: UserDefaults.standard.string(forKey: "shotRoom"),
        newRoom: UserDefaults.standard.string(forKey: "shotNewRoom"), navigation: navigation)
      let pause = UserDefaults.standard.double(forKey: "shotToggleSidebar")
      if pause > 0 { Task { await ShotHooks.toggleSidebar(pause: pause) } }
      if let file = UserDefaults.standard.string(forKey: "shotSheet") {
        Task { await ShotHooks.saveSheet(to: file) }
      }
      if let keys = UserDefaults.standard.string(forKey: "shotKeys"),
        let file = UserDefaults.standard.string(forKey: "shotKeysOut")
      {
        Task { await ShotHooks.pressKeys(keys, logTo: file) }
      }
      if let file = UserDefaults.standard.string(forKey: "shotSettings") {
        Task { await ShotHooks.openSettings(numberInto: file) }
      }
      if let file = PerfHooks.file {
        Task { await PerfHooks.run(store: store, client: client, navigation: navigation, file: file) }
      }
      if UserDefaults.standard.bool(forKey: "shotMenu") { Task { await ShotHooks.openMenu() } }
      let width = UserDefaults.standard.double(forKey: "shotWidth")
      if width > 0 { Task { await ShotHooks.resize(width: width) } }
      if let file = UserDefaults.standard.string(forKey: "shotHotkey") {
        Task { await ShotHooks.pressHotkey(hotkey, settings: settings, logTo: file) }
      }
    #else
      trackHotkey()
    #endif
  }

  /// The human may have changed the app's notifications in System Settings while away.
  func applicationDidBecomeActive(_ notification: Notification) {
    Task { await notifier.refreshBlock() }
  }

  func applicationWillTerminate(_ notification: Notification) {
    hotkey.unregister()
  }

  /// Runs the spinner clock only while some agent in the feed is thinking.
  private func trackThinking() {
    withObservationTracking {
      ThinkingClock.shared.thinking = store.rooms.contains { $0.members.contains(where: \.isThinking) }
    } onChange: {
      Task { @MainActor [weak self] in self?.trackThinking() }
    }
  }

  /// Pauses the spinner clock while no window of the app shows, so a hidden app draws nothing.
  private func trackVisibility() {
    let names = [
      NSWindow.didChangeOcclusionStateNotification, NSApplication.didHideNotification,
      NSApplication.didUnhideNotification,
    ]
    for name in names {
      NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { _ in
        MainActor.assumeIsolated {
          ThinkingClock.shared.visible = NSApp.windows.contains {
            $0.styleMask.contains(.titled) && $0.isVisible && $0.occlusionState.contains(.visible)
          }
        }
      }
    }
  }

  /// Holds the keys from Settings, and swaps them each time they change there.
  private func trackHotkey() {
    withObservationTracking {
      hotkey.register(settings.snapshot.hotkey.registration)
    } onChange: {
      Task { @MainActor [weak self] in self?.trackHotkey() }
    }
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    [.banner, .list, .sound]
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
  ) async {
    let info = response.notification.request.content.userInfo
    let room = info[Notifier.roomKey] as? String
    if let option = optionIndex(of: response.actionIdentifier), let question = info[Notifier.questionKey] as? String {
      await answer(question, option: option, room: room)
    } else {
      await show(room)
    }
  }

  /// A pick from a banner answers through the same human seat as the card. A question already gone opens its room.
  private func answer(_ id: String, option: Int, room: String?) async {
    guard let question = store.room(named: room)?.questions.first(where: { $0.id == id }) else {
      show(room)
      return
    }
    if let reason = await store.answer(question, option: option, via: client) {
      notifier.refused(reason, room: question.room)
    }
  }

  private func show(_ room: String?) {
    if let room { navigation.room = room }
    navigation.windowRequests += 1
    NSApp.activate()
  }
}

@main
struct MesshallApp: App {
  static let windowID = "main"

  @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

  var body: some Scene {
    Window("Messhall", id: Self.windowID) {
      MainWindow(store: delegate.store, client: delegate.client, navigation: delegate.navigation)
        .frame(minWidth: 720, minHeight: 440)
        .environment(delegate.notifier)
        .environment(delegate.pullRequests)
        .accentFromSettings()
    }
    .defaultSize(width: 980, height: 640)
    .commands {
      SidebarCommands()
      CommandGroup(replacing: .newItem) {
        NewRoomCommand(navigation: delegate.navigation)
        RoomToggleCommand()
      }
    }

    Settings {
      SettingsView(store: delegate.store, settings: delegate.settings)
        .environment(delegate.notifier)
    }

    MenuBarExtra {
      MenuBarMenu(store: delegate.store, navigation: delegate.navigation)
        .environment(delegate.notifier)
    } label: {
      MenuBarLabel(store: delegate.store, navigation: delegate.navigation)
    }
  }
}

struct NewRoomCommand: View {
  let navigation: Navigation
  @Environment(\.openWindow) private var openWindow

  var body: some View {
    Button("New Room\u{2026}") {
      openWindow(id: MesshallApp.windowID)
      navigation.newRoomDraft = ""
    }
    .keyboardShortcut("n")
  }
}
