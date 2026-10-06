import AppKit
import Feed
import SwiftUI

@Observable
@MainActor
final class Navigation {
  var room: String?
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  let store = FeedStore()
  let client = FeedClient()
  let navigation = Navigation()

  func applicationWillFinishLaunching(_ notification: Notification) {
    #if DEBUG
      if let dir = UserDefaults.standard.string(forKey: "renderStatus") {
        ShotHooks.renderStatus(into: URL(fileURLWithPath: dir))
        exit(0)
      }
      ShotHooks.forceAppearance(UserDefaults.standard.string(forKey: "shotAppearance"))
    #endif
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    Task { await store.run(client) }
    #if DEBUG
      if let text = UserDefaults.standard.string(forKey: "shotPost") {
        Task { await ShotHooks.post(text, store: store, client: client) }
      }
    #endif
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
    }
    .defaultSize(width: 980, height: 640)
    .commands { SidebarCommands() }

    MenuBarExtra {
      MenuBarMenu(store: delegate.store, navigation: delegate.navigation)
    } label: {
      MenuBarLabel(store: delegate.store)
    }
  }
}
