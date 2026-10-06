import Foundation

/// The daemon's room name rule, `[a-z0-9-]{1,40}`, checked as the human types.
public enum RoomName {
  public static let maxLength = 40

  private static let allowed = Set("abcdefghijklmnopqrstuvwxyz0123456789-")

  /// What is wrong with the name, or nil. An empty name has nothing to show yet.
  public static func problem(_ name: String, taken: [String]) -> String? {
    if name.isEmpty { return nil }
    if !name.allSatisfy(allowed.contains) { return "Use lowercase letters, numbers and dashes." }
    if name.count > maxLength { return "Keep it to \(maxLength) characters or fewer." }
    if taken.contains(name) { return "#\(name) already exists." }
    return nil
  }

  public static func isValid(_ name: String, taken: [String]) -> Bool {
    !name.isEmpty && problem(name, taken: taken) == nil
  }
}
