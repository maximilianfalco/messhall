import Foundation
import Testing

@testable import Feed

@Suite("AppSettings")
@MainActor
struct AppSettingsTests {
  private static let teal = RGB(red: 0.1, green: 0.5, blue: 0.5)

  private func freshDefaults() -> UserDefaults {
    let name = "messhall-tests-\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: name)!
    defaults.removePersistentDomain(forName: name)
    return defaults
  }

  @Test("a fresh store follows the system, notifies and has no overrides")
  func defaults() {
    let settings = AppSettings(defaults: freshDefaults())

    #expect(settings.snapshot == SettingsSnapshot())
    #expect(settings.snapshot.appearance == .system)
    #expect(settings.snapshot.accent == .system)
    #expect(settings.snapshot.notificationsEnabled)
    #expect(settings.snapshot.mutedRooms.isEmpty)
    #expect(settings.snapshot.avatars.colors.isEmpty)
  }

  @Test("every change is read back by a new store on the same defaults")
  func roundTrip() {
    let defaults = freshDefaults()
    let settings = AppSettings(defaults: defaults)

    settings.snapshot.appearance = .dark
    settings.snapshot.accent = .green
    settings.snapshot.notificationsEnabled = false
    settings.snapshot.mutedRooms = ["checkout"]
    settings.snapshot.avatars.set(Self.teal, for: "web")
    settings.snapshot.pane = .avatars

    #expect(AppSettings(defaults: defaults).snapshot == settings.snapshot)
  }

  @Test("a stored blob missing newer fields keeps the ones it has")
  func partialBlob() {
    let defaults = freshDefaults()
    defaults.set(#"{"appearance":"light"}"#, forKey: AppSettings.key)

    let snapshot = AppSettings(defaults: defaults).snapshot

    #expect(snapshot.appearance == .light)
    #expect(snapshot.notificationsEnabled)
  }

  @Test("a blob that does not parse falls back to the defaults")
  func badBlob() {
    let defaults = freshDefaults()
    defaults.set("not json", forKey: AppSettings.key)

    #expect(AppSettings(defaults: defaults).snapshot == SettingsSnapshot())
  }

  @Test("the old notification keys carry over when there is no blob yet")
  func legacyKeys() {
    let defaults = freshDefaults()
    defaults.set(false, forKey: "notificationsEnabled")
    defaults.set(["billing", "checkout"], forKey: "mutedRooms")

    let snapshot = AppSettings(defaults: defaults).snapshot

    #expect(!snapshot.notificationsEnabled)
    #expect(snapshot.mutedRooms == ["billing", "checkout"])
  }

  @Test("a room mute toggles on and off")
  func toggleMute() {
    var snapshot = SettingsSnapshot()

    snapshot.toggleMute("checkout")
    #expect(snapshot.mutedRooms == ["checkout"])
    snapshot.toggleMute("checkout")
    #expect(snapshot.mutedRooms.isEmpty)
  }
}

@Suite("AvatarOverrides")
struct AvatarOverridesTests {
  private static let teal = RGB(red: 0.1, green: 0.5, blue: 0.5)
  private static let plum = RGB(red: 0.5, green: 0.2, blue: 0.5)

  @Test("an override is found by member name, others have none")
  func lookup() {
    var overrides = AvatarOverrides()
    overrides.set(Self.teal, for: "web")

    #expect(overrides.color(for: "web") == Self.teal)
    #expect(overrides.color(for: "api") == nil)
  }

  @Test("reset drops one name, reset all drops every name")
  func reset() {
    var overrides = AvatarOverrides()
    overrides.set(Self.teal, for: "web")
    overrides.set(Self.plum, for: "api")

    overrides.reset("web")
    #expect(overrides.color(for: "web") == nil)
    #expect(overrides.color(for: "api") == Self.plum)

    overrides.resetAll()
    #expect(overrides.colors.isEmpty)
  }
}
