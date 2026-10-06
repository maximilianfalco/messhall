import Foundation
import SwiftUI

/// An sRGB color with channels from 0 to 1.
public struct RGB: Equatable, Sendable {
  public let red: Double
  public let green: Double
  public let blue: Double

  public static let white = RGB(red: 1, green: 1, blue: 1)
  public static let black = RGB(red: 0, green: 0, blue: 0)
}

private let saturation = 0.6
private let lightestFill = 0.5

/// The member's hue from 0 to 359. FNV-1a, since Swift's own hash changes on every launch.
public func avatarHue(for name: String) -> Int {
  let hash = name.utf8.reduce(UInt32(2_166_136_261)) { ($0 ^ UInt32($1)) &* 16_777_619 }
  return Int(hash % 360)
}

/// The circle fill for a hue: the lightest tone that still keeps white text at WCAG AA.
/// Yellow and green go darker than blue so every hue reads the same.
public func avatarFill(hue: Int) -> RGB {
  var lightness = lightestFill
  while contrastRatio(hsl(hue: hue, lightness: lightness), .white) < 4.5 { lightness -= 0.01 }
  return hsl(hue: hue, lightness: lightness)
}

/// The circle fill for a member name, the same in every room and on every launch.
public func avatarColor(for name: String) -> Color {
  let fill = avatarFill(hue: avatarHue(for: name))
  return Color(red: fill.red, green: fill.green, blue: fill.blue)
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
