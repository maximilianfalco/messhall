import AppKit
import Feed
import SwiftUI
import UserNotifications

@Observable
@MainActor
final class Navigation {
  var room: String?
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
  let store = FeedStore()
  let client = FeedClient()
  let navigation = Navigation()
  let notifier = Notifier()

  func applicationWillFinishLaunching(_ notification: Notification) {
    UNUserNotificationCenter.current().delegate = self
    #if DEBUG
      if let dir = UserDefaults.standard.string(forKey: "renderStatus") {
        ShotHooks.renderStatus(into: URL(fileURLWithPath: dir))
        exit(0)
      }
      ShotHooks.forceAppearance(UserDefaults.standard.string(forKey: "shotAppearance"))
    #endif
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    notifier.requestPermission()
    store.onEvent = { [notifier, unowned store] event, room in
      notifier.notify(event, room: room, liveSince: store.liveSince)
    }
    Task { await store.run(client) }
    #if DEBUG
      if let text = UserDefaults.standard.string(forKey: "shotPost") {
        Task { await ShotHooks.post(text, store: store, client: client) }
      }
    #endif
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    [.banner, .list, .sound]
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
  ) async {
    let room = response.notification.request.content.userInfo[Notifier.roomKey] as? String
    await show(room)
  }

  private func show(_ room: String?) {
    if let room { navigation.room = room }
    NSApp.activate()
    NSApp.windows.first { $0.identifier?.rawValue == MesshallApp.windowID }?.makeKeyAndOrderFront(nil)
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
    }
    .defaultSize(width: 980, height: 640)
    .commands { SidebarCommands() }

    MenuBarExtra {
      MenuBarMenu(store: delegate.store, navigation: delegate.navigation)
        .environment(delegate.notifier)
    } label: {
      MenuBarLabel(store: delegate.store)
    }
  }
}
