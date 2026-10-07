import Foundation

/// Loads `GET /api/snapshot`: every room with its members and last 50 messages.
public struct SnapshotLoader: Sendable {
  let client: FeedClient

  public init(client: FeedClient) {
    self.client = client
  }

  public func load() async throws -> Snapshot {
    let (data, response) = try await client.session.data(for: try client.request(.snapshot))
    try client.check(response, data)
    return try Self.read(data)
  }
}
