import Foundation
import SwiftUI

/// An sRGB color with channels from 0 to 1.
public struct RGB: Codable, Equatable, Sendable {
  public let red: Double
  public let green: Double
  public let blue: Double

  public init(red: Double, green: Double, blue: Double) {
    self.red = red
    self.green = green
    self.blue = blue
  }

  public static let white = RGB(red: 1, green: 1, blue: 1)
  public static let black = RGB(red: 0, green: 0, blue: 0)
}

private let saturation = 0.6
private let lightestFill = 0.5

/// FNV-1a, since Swift's own hash changes on every launch.
private func avatarHash(for name: String) -> UInt32 {
  name.utf8.reduce(UInt32(2_166_136_261)) { ($0 ^ UInt32($1)) &* 16_777_619 }
}

/// The member's hue from 0 to 359.
public func avatarHue(for name: String) -> Int {
  Int(avatarHash(for: name) % 360)
}

/// The face on a member's circle. Eyes and mouth come from the hash bits the hue does not use.
public struct AvatarFace: Equatable, Hashable, Sendable {
  public let eyeSpread: Int
  public let mouth: Int
}

public func avatarFace(for name: String) -> AvatarFace {
  let bits = avatarHash(for: name) / 360
  return AvatarFace(eyeSpread: Int(bits % 3), mouth: Int(bits / 3 % 3))
}

/// How many pictures each bundled style ships.
public let avatarArtCount = 32

/// Which of the shipped pictures a name gets. Uses hash bits the hue does not.
public func avatarArt(for name: String) -> Int {
  Int(avatarHash(for: name) / 360 % UInt32(avatarArtCount))
}

public func avatarArtFile(_ number: Int) -> String {
  String(format: "%02d.png", number + 1)
}

/// The circle fill for a hue: the lightest tone that still keeps white text at WCAG AA.
/// Yellow and green go darker than blue so every hue reads the same.
public func avatarFill(hue: Int) -> RGB {
  var lightness = lightestFill
  while contrastRatio(hsl(hue: hue, lightness: lightness), .white) < 4.5 { lightness -= 0.01 }
  return hsl(hue: hue, lightness: lightness)
}

// Every hue's fill once, since the contrast search runs tens of steps and a row draws it on each build.
private let avatarFills = (0..<360).map(avatarFill)

/// The circle fill for a member name: the human's pick from Settings, else the same hashed hue everywhere.
@MainActor
public func avatarRGB(for name: String, in settings: AppSettings = .shared) -> RGB {
  settings.snapshot.avatars.color(for: name) ?? avatarFills[avatarHue(for: name)]
}

@MainActor
public func avatarColor(for name: String, in settings: AppSettings = .shared) -> Color {
  Color(avatarRGB(for: name, in: settings))
}

/// The human sits on the accent color, so no agent's hashed color can pass for it.
public func avatarUsesAccent(_ name: String) -> Bool { name == humanName }

/// White while it keeps AA on the fill, else black. A picked color can be too light for white.
public func avatarInk(on fill: RGB) -> RGB {
  contrastRatio(fill, .white) >= 4.5 ? .white : .black
}

extension Color {
  public init(_ rgb: RGB) {
    self.init(red: rgb.red, green: rgb.green, blue: rgb.blue)
  }
}

/// One letter, or two when the name has a dash: `f8-search` is `FS`.
public func avatarLabel(for name: String) -> String {
  let parts = name.split(separator: "-").prefix(2)
  guard !parts.isEmpty else { return "?" }
  return parts.compactMap(\.first).map(String.init).joined().uppercased()
}

/// The WCAG 2 contrast ratio between two colors, from 1 to 21.
public func contrastRatio(_ a: RGB, _ b: RGB) -> Double {
  let (lighter, darker) = (max(luminance(a), luminance(b)), min(luminance(a), luminance(b)))
  return (lighter + 0.05) / (darker + 0.05)
}

private func luminance(_ color: RGB) -> Double {
  func linear(_ c: Double) -> Double { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
  return 0.2126 * linear(color.red) + 0.7152 * linear(color.green) + 0.0722 * linear(color.blue)
}

private func hsl(hue: Int, lightness: Double) -> RGB {
  let chroma = (1 - abs(2 * lightness - 1)) * saturation
  func channel(_ n: Double) -> Double {
    let k = (n + Double(hue) / 30).truncatingRemainder(dividingBy: 12)
    return lightness - chroma / 2 * max(-1, min(k - 3, 9 - k, 1))
  }
  return RGB(red: channel(0), green: channel(8), blue: channel(4))
}
