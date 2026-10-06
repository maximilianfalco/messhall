import Carbon.HIToolbox
import Foundation
import SwiftUI

/// The modifier sets the hotkey can use. Each holds control, option or command, so it never eats plain typing.
public enum HotkeyModifiers: String, Codable, CaseIterable, Sendable {
  case controlOption, controlCommand, optionCommand, shiftCommand, controlOptionCommand

  /// In the order macOS menus draw them.
  public var symbols: String {
    switch self {
    case .controlOption: "⌃⌥"
    case .controlCommand: "⌃⌘"
    case .optionCommand: "⌥⌘"
    case .shiftCommand: "⇧⌘"
    case .controlOptionCommand: "⌃⌥⌘"
    }
  }

  var eventModifiers: SwiftUI.EventModifiers {
    switch self {
    case .controlOption: [.control, .option]
    case .controlCommand: [.control, .command]
    case .optionCommand: [.option, .command]
    case .shiftCommand: [.shift, .command]
    case .controlOptionCommand: [.control, .option, .command]
    }
  }

  var carbonFlags: UInt32 {
    switch self {
    case .controlOption: UInt32(controlKey | optionKey)
    case .controlCommand: UInt32(controlKey | cmdKey)
    case .optionCommand: UInt32(optionKey | cmdKey)
    case .shiftCommand: UInt32(shiftKey | cmdKey)
    case .controlOptionCommand: UInt32(controlKey | optionKey | cmdKey)
    }
  }
}

/// What `RegisterEventHotKey` takes.
public struct HotkeyRegistration: Equatable, Sendable {
  public let keyCode: UInt32
  public let modifiers: UInt32
}

/// The global hotkey that brings the Messhall window forward from any app.
public struct Hotkey: Codable, Equatable, Sendable {
  /// Key codes are spots on a US keyboard, so other layouts get the key in the same place.
  private static let codes: [String: Int] = [
    "A": kVK_ANSI_A, "B": kVK_ANSI_B, "C": kVK_ANSI_C, "D": kVK_ANSI_D, "E": kVK_ANSI_E, "F": kVK_ANSI_F,
    "G": kVK_ANSI_G, "H": kVK_ANSI_H, "I": kVK_ANSI_I, "J": kVK_ANSI_J, "K": kVK_ANSI_K, "L": kVK_ANSI_L,
    "M": kVK_ANSI_M, "N": kVK_ANSI_N, "O": kVK_ANSI_O, "P": kVK_ANSI_P, "Q": kVK_ANSI_Q, "R": kVK_ANSI_R,
    "S": kVK_ANSI_S, "T": kVK_ANSI_T, "U": kVK_ANSI_U, "V": kVK_ANSI_V, "W": kVK_ANSI_W, "X": kVK_ANSI_X,
    "Y": kVK_ANSI_Y, "Z": kVK_ANSI_Z, "0": kVK_ANSI_0, "1": kVK_ANSI_1, "2": kVK_ANSI_2, "3": kVK_ANSI_3,
    "4": kVK_ANSI_4, "5": kVK_ANSI_5, "6": kVK_ANSI_6, "7": kVK_ANSI_7, "8": kVK_ANSI_8, "9": kVK_ANSI_9,
  ]

  /// The keys Settings offers, letters then digits.
  public static let keys = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".map(String.init)

  /// Kept apart from the key, so turning it back on brings back the same keys.
  public var enabled = true
  public var key = "M"
  public var modifiers = HotkeyModifiers.controlOption

  public init() {}

  /// Missing fields keep their default, so a blob from an older build still loads.
  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? enabled
    key = try c.decodeIfPresent(String.self, forKey: .key) ?? key
    modifiers = try c.decodeIfPresent(HotkeyModifiers.self, forKey: .modifiers) ?? modifiers
  }

  public var label: String { modifiers.symbols + key }

  /// The same keys drawn beside Open Messhall in the menu bar menu.
  public var shortcut: KeyboardShortcut? {
    guard registration != nil, let character = key.lowercased().first else { return nil }
    return KeyboardShortcut(KeyEquivalent(character), modifiers: modifiers.eventModifiers)
  }

  /// Nil when off or when the key is not one Settings offers.
  public var registration: HotkeyRegistration? {
    guard enabled, let code = Self.codes[key] else { return nil }
    return HotkeyRegistration(keyCode: UInt32(code), modifiers: modifiers.carbonFlags)
  }
}
