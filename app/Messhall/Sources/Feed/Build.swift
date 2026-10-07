import Foundation

/// The commit a daemon or an app was built from. `committedAt` is ISO 8601 in UTC.
public struct Build: Codable, Equatable, Sendable {
  public var commit: String
  public var committedAt: String

  public init(commit: String, committedAt: String) {
    self.commit = commit
    self.committedAt = committedAt
  }

  enum CodingKeys: String, CodingKey, CaseIterable {
    case commit
    case committedAt = "committed_at"
  }
}
