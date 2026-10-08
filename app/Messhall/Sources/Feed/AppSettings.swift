import Foundation
import Observation
import SwiftUI

public enum AppearanceChoice: String, Codable, CaseIterable, Sendable {
  case system, light, dark
}

public enum AccentChoice: String, Codable, CaseIterable, Sendable {
  case system, blue, purple, pink, red, orange, yellow, green, graphite

  /// Nil means the system accent, so `.tint(nil)` leaves controls alone.
  public var color: Color? {
    switch self {
    case .system: nil
    case .blue: .blue
    case .purple: .purple
    case .pink: .pink
    case .red: .red
    case .orange: .orange
    case .yellow: .yellow
    case .green: .green
    case .graphite: .gray
    }
  }
}

/// A drawn face, a bundled picture set (DiceBear Shapes or Notionists Neutral), or the plain circle with initials.
public enum AvatarStyle: String, Codable, CaseIterable, Sendable {
  case face, shapes, notionists, initials

  public var title: String {
    switch self {
    case .face: "Faces"
    case .shapes: "Shapes"
    case .notionists: "Notionists"
    case .initials: "Initials"
    }
  }

  /// The folder under the app's `Avatars` resources, or nil when the style is drawn.
  public var artFolder: String? {
    switch self {
    case .shapes: "shapes"
    case .notionists: "notionists-neutral"
    case .face, .initials: nil
    }
  }
}

public enum SettingsPane: String, Codable, CaseIterable, Sendable {
  case appearance, avatars, notifications, shortcut
}

/// Avatar colors the human picked, keyed by member name.
public struct AvatarOverrides: Codable, Equatable, Sendable {
  public private(set) var colors: [String: RGB] = [:]

  public init() {}

  public func color(for name: String) -> RGB? { colors[name] }
  public mutating func set(_ color: RGB, for name: String) { colors[name] = color }
  public mutating func reset(_ name: String) { colors[name] = nil }
  public mutating func resetAll() { colors = [:] }
}

/// Every app setting as one plain value, stored as JSON.
public struct SettingsSnapshot: Codable, Equatable, Sendable {
  public var appearance = AppearanceChoice.system
  public var accent = AccentChoice.system
  public var notificationsEnabled = true
  public var mutedRooms: Set<String> = []
  public var collapsedAgreements: Set<String> = []
  public var avatars = AvatarOverrides()
  public var avatarStyle = AvatarStyle.face
  public var pane = SettingsPane.appearance
  public var hotkey = Hotkey()
  public var pullRequestCards = true
  public var welcomed = false

  public init() {}

  /// Missing fields keep their default, so a blob from an older build still loads.
  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    appearance = try c.decodeIfPresent(AppearanceChoice.self, forKey: .appearance) ?? appearance
    accent = try c.decodeIfPresent(AccentChoice.self, forKey: .accent) ?? accent
    notificationsEnabled = try c.decodeIfPresent(Bool.self, forKey: .notificationsEnabled) ?? notificationsEnabled
    mutedRooms = try c.decodeIfPresent(Set<String>.self, forKey: .mutedRooms) ?? mutedRooms
    collapsedAgreements = try c.decodeIfPresent(Set<String>.self, forKey: .collapsedAgreements) ?? collapsedAgreements
    avatars = try c.decodeIfPresent(AvatarOverrides.self, forKey: .avatars) ?? avatars
    avatarStyle = try c.decodeIfPresent(AvatarStyle.self, forKey: .avatarStyle) ?? avatarStyle
    pane = try c.decodeIfPresent(SettingsPane.self, forKey: .pane) ?? pane
    hotkey = try c.decodeIfPresent(Hotkey.self, forKey: .hotkey) ?? hotkey
    pullRequestCards = try c.decodeIfPresent(Bool.self, forKey: .pullRequestCards) ?? pullRequestCards
    welcomed = try c.decodeIfPresent(Bool.self, forKey: .welcomed) ?? welcomed
  }

  public mutating func toggleMute(_ room: String) {
    if mutedRooms.remove(room) == nil { mutedRooms.insert(room) }
  }

  public mutating func toggleAgreementsFold(_ room: String) {
    if collapsedAgreements.remove(room) == nil { collapsedAgreements.insert(room) }
  }
}

/// The one settings store. Each change is written to `UserDefaults` as a JSON string.
/// A string, so app-shot can hand a whole snapshot in as a launch arg.
@MainActor
@Observable
public final class AppSettings {
  public static let key = "appSettings"
  public static let shared = AppSettings(defaults: .standard)

  @ObservationIgnored private let defaults: UserDefaults

  public var snapshot: SettingsSnapshot {
    didSet { save() }
  }

  public init(defaults: UserDefaults) {
    self.defaults = defaults
    snapshot = Self.load(defaults)
  }

  private func save() {
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    guard let data = try? encoder.encode(snapshot) else { return }
    defaults.set(String(decoding: data, as: UTF8.self), forKey: Self.key)
  }

  private static func load(_ defaults: UserDefaults) -> SettingsSnapshot {
    guard let text = defaults.string(forKey: key) else { return legacy(defaults) }
    return (try? JSONDecoder().decode(SettingsSnapshot.self, from: Data(text.utf8))) ?? SettingsSnapshot()
  }

  /// Builds before the Settings window kept the bell and the menu toggle under their own keys.
  private static func legacy(_ defaults: UserDefaults) -> SettingsSnapshot {
    var snapshot = SettingsSnapshot()
    snapshot.notificationsEnabled = defaults.object(forKey: "notificationsEnabled") as? Bool ?? true
    snapshot.mutedRooms = Set(defaults.stringArray(forKey: "mutedRooms") ?? [])
    return snapshot
  }
}
