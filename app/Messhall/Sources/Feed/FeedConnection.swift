import Foundation

extension FeedStore {
  static let retryDelay = Duration.seconds(2)

  /// Loads the snapshot once, then follows the event stream, retrying every 2 s while the daemon is down.
  public func run(_ client: FeedClient) async {
    while !Task.isCancelled {
      do {
        if !loaded {
          apply(.snapshot(try await SnapshotLoader(client: client).load()))
        }
        for try await update in EventStream(client: client).updates(after: seq) {
          setPhase(.live)
          if let update { apply(update) }
        }
      } catch {
        setPhase(.down(Self.downReason(error)))
      }
      try? await Task.sleep(for: Self.retryDelay)
    }
  }

  /// Posts as the human and shows the message at once. Returns the refusal text, or nil.
  public func post(_ text: String, room: String, via client: FeedClient) async -> String? {
    switch await HumanSeat(client: client).post(room: room, text: text) {
    case .posted(let message):
      add(message, to: room)
      return nil
    case .refused(let reason):
      return reason
    }
  }

  nonisolated static func downReason(_ error: Error) -> String {
    switch error {
    case is FeedClient.KeyMissing: "No human key yet."
    case let refused as FeedClient.Refused: refused.message
    default: "Messhall is not running."
    }
  }
}
