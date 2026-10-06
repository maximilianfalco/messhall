import Foundation
import SwiftUI
import Testing

@testable import Feed

@Suite("Hotkey")
struct HotkeyTests {
  @Test("the default is control option M and on")
  func defaults() {
    let hotkey = Hotkey()

    #expect(hotkey.enabled)
    #expect(hotkey.label == "⌃⌥M")
    #expect(hotkey.registration == HotkeyRegistration(keyCode: 46, modifiers: 0x1800))
  }

  @Test("an off hotkey registers nothing")
  func off() {
    var hotkey = Hotkey()
    hotkey.enabled = false

    #expect(hotkey.registration == nil)
  }

  @Test("a key outside the list registers nothing")
  func unknownKey() {
    var hotkey = Hotkey()
    hotkey.key = "é"

    #expect(hotkey.registration == nil)
  }

  @Test(
    "keys map to their Carbon key codes",
    arguments: [("A", 0), ("S", 1), ("Q", 12), ("O", 31), ("K", 40), ("Z", 6), ("0", 29), ("5", 23), ("9", 25)])
  func keyCodes(key: String, code: UInt32) {
    var hotkey = Hotkey()
    hotkey.key = key

    #expect(hotkey.registration?.keyCode == code)
  }

  @Test("every listed key has its own code")
  func distinctCodes() {
    let codes = Hotkey.keys.compactMap { key in
      var hotkey = Hotkey()
      hotkey.key = key
      return hotkey.registration?.keyCode
    }

    #expect(Hotkey.keys.count == 36)
    #expect(Set(codes).count == Hotkey.keys.count)
  }

  @Test(
    "modifiers map to Carbon flags and menu symbols",
    arguments: [
      (HotkeyModifiers.controlOption, UInt32(0x1800), "⌃⌥"),
      (.controlCommand, 0x1100, "⌃⌘"),
      (.optionCommand, 0x0900, "⌥⌘"),
      (.shiftCommand, 0x0300, "⇧⌘"),
      (.controlOptionCommand, 0x1900, "⌃⌥⌘"),
    ])
  func modifiers(modifiers: HotkeyModifiers, flags: UInt32, symbols: String) {
    var hotkey = Hotkey()
    hotkey.modifiers = modifiers
    hotkey.key = "K"

    #expect(hotkey.registration?.modifiers == flags)
    #expect(hotkey.label == "\(symbols)K")
  }

  @Test("the menu shows the same keys, and none while off")
  func menuShortcut() {
    var hotkey = Hotkey()
    #expect(hotkey.shortcut == KeyboardShortcut("m", modifiers: [.control, .option]))

    hotkey.modifiers = .shiftCommand
    hotkey.key = "7"
    #expect(hotkey.shortcut == KeyboardShortcut("7", modifiers: [.shift, .command]))

    hotkey.enabled = false
    #expect(hotkey.shortcut == nil)
  }

  @Test("a stored blob keeps the hotkey turned off")
  @MainActor
  func storedOff() {
    let name = "messhall-tests-\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: name)!
    defaults.removePersistentDomain(forName: name)
    let settings = AppSettings(defaults: defaults)

    settings.snapshot.hotkey.enabled = false
    settings.snapshot.hotkey.key = "K"
    settings.snapshot.hotkey.modifiers = .controlCommand

    #expect(AppSettings(defaults: defaults).snapshot.hotkey == settings.snapshot.hotkey)
  }

  @Test("a blob from before the hotkey gets the default")
  @MainActor
  func olderBlob() {
    let name = "messhall-tests-\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: name)!
    defaults.removePersistentDomain(forName: name)
    defaults.set(#"{"appearance":"dark"}"#, forKey: AppSettings.key)

    #expect(AppSettings(defaults: defaults).snapshot.hotkey == Hotkey())
  }

  @Test("a hotkey blob missing fields keeps the ones it has")
  func partialHotkey() throws {
    let hotkey = try JSONDecoder().decode(Hotkey.self, from: Data(#"{"enabled":false}"#.utf8))

    #expect(!hotkey.enabled)
    #expect(hotkey.key == "M")
    #expect(hotkey.modifiers == .controlOption)
  }
}
