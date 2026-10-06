import Foundation

/// Reads `GET /api/events` as updates, resuming after a sequence with `Last-Event-ID`.
public struct EventStream: Sendable {
  struct Ended: Error {}

  let client: FeedClient

  public init(client: FeedClient) {
    self.client = client
  }

  /// Yields nil when the stream opens and on each ping, so the caller knows it is live.
  /// Ends with an error when the daemon goes away or stops pinging, so the caller reconnects.
  public func updates(after seq: Int) -> AsyncThrowingStream<FeedUpdate?, Error> {
    AsyncThrowingStream { continuation in
      let task = Task {
        do {
          let (bytes, response) = try await client.session.bytes(for: try client.request(.events(after: seq)))
          try client.check(response)
          continuation.yield(nil)
          var parser = SSEParser()
          var line: [UInt8] = []
          for try await byte in bytes {
            line.append(byte)
            guard byte == UInt8(ascii: "\n") else { continue }
            for item in parser.push(String(decoding: line, as: UTF8.self)) {
              continuation.yield(try FeedUpdate.decode(item))
            }
            line.removeAll(keepingCapacity: true)
          }
          continuation.finish(throwing: Ended())
        } catch {
          continuation.finish(throwing: error)
        }
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }
}
