import Foundation

/// What the store applies: a whole snapshot, or one event at its sequence.
public enum FeedUpdate: Equatable, Sendable {
  case snapshot(Snapshot)
  case event(seq: Int, BusEvent)

  static let snapshotEvent = "snapshot"

  /// Decodes one SSE item. A ping, or a frame with no numeric id, gives nil.
  public static func decode(_ item: SSEItem) throws -> FeedUpdate? {
    guard case .event(let id, let name, let data) = item else { return nil }
    let bytes = Data(data.utf8)
    if name == snapshotEvent { return .snapshot(try JSONDecoder().decode(Snapshot.self, from: bytes)) }
    guard let seq = id.flatMap(Int.init) else { return nil }
    return .event(seq: seq, try JSONDecoder().decode(BusEvent.self, from: bytes))
  }
}
