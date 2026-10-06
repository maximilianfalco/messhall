import Foundation

/// Posts as the human through `POST /api/rooms/:name/messages`.
public struct HumanSeat: Sendable {
  public enum Outcome: Equatable, Sendable {
    case posted(Message)
    case refused(String)
  }

  let client: FeedClient

  public init(client: FeedClient) {
    self.client = client
  }

  public func post(room: String, text: String) async -> Outcome {
    do {
      let (data, response) = try await client.session.data(for: try client.request(.post(room: room, text: text)))
      try client.check(response, data)
      return .posted(try JSONDecoder().decode(HumanPostResult.self, from: data).message)
    } catch let refused as FeedClient.Refused {
      return .refused(refused.message)
    } catch {
      return .refused(FeedStore.downReason(error))
    }
  }
}
