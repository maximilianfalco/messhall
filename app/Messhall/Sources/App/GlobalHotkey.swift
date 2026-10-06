import Carbon.HIToolbox
import Feed

/// The one hotkey that works from any app. Carbon hotkeys need no Accessibility permission.
@MainActor
final class GlobalHotkey {
  static let id = EventHotKeyID(signature: 0x4D53_484C, id: 1)

  private let onPress: () -> Void
  private var handler: EventHandlerRef?
  private var hotKey: EventHotKeyRef?
  private var current: HotkeyRegistration?

  init(onPress: @escaping () -> Void) {
    self.onPress = onPress
  }

  /// Swaps the held keys for these, or lets go on nil. Gives the Carbon status, `noErr` when held.
  @discardableResult
  func register(_ registration: HotkeyRegistration?) -> OSStatus {
    guard registration != current else { return noErr }
    unregister()
    guard let registration else { return noErr }
    installHandler()
    let status = RegisterEventHotKey(
      registration.keyCode, registration.modifiers, Self.id, GetApplicationEventTarget(), 0, &hotKey)
    if status == noErr { current = registration }
    return status
  }

  func unregister() {
    if let hotKey { UnregisterEventHotKey(hotKey) }
    hotKey = nil
    current = nil
  }

  private func installHandler() {
    guard handler == nil else { return }
    var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
    let target = Unmanaged.passUnretained(self).toOpaque()
    // Carbon sends app target events on the main thread.
    InstallEventHandler(
      GetApplicationEventTarget(),
      { _, _, target in
        guard let target else { return OSStatus(eventNotHandledErr) }
        let hotkey = Unmanaged<GlobalHotkey>.fromOpaque(target).takeUnretainedValue()
        MainActor.assumeIsolated { hotkey.onPress() }
        return noErr
      }, 1, &spec, target, &handler)
  }
}
