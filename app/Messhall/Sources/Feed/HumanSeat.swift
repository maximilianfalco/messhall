import Foundation

/// Acts as the human: posts messages, makes, closes and reopens rooms, and sets roles.
public struct HumanSeat: Sendable {
  public enum Outcome<Value: Equatable & Sendable>: Equatable, Sendable {
    case done(Value)
    case refused(String)
  }

  let client: FeedClient

  public init(client: FeedClient) {
    self.client = client
  }

  public func post(room: String, text: String) async -> Outcome<Message> {
    await send(.post(room: room, text: text), as: HumanPostResult.self) { $0.message }
  }

  public func create(_ room: NewRoom) async -> Outcome<Room> {
    await send(.newRoom(room), as: RoomResult.self) { $0.room }
  }

  public func close(room: String) async -> Outcome<Room> {
    await send(.close(room: room), as: RoomResult.self) { $0.room }
  }

  public func reopen(room: String) async -> Outcome<Room> {
    await send(.reopen(room: room), as: RoomResult.self) { $0.room }
  }

  public func setRole(_ role: String, member: String, room: String) async -> Outcome<HumanRoleResult> {
    await send(.role(room: room, member: member, role: role), as: HumanRoleResult.self) { $0 }
  }

  private func send<Body: Decodable, Value>(
    _ route: FeedClient.Route, as: Body.Type, _ pick: (Body) -> Value
  ) async -> Outcome<Value> {
    do {
      let (data, response) = try await client.session.data(for: try client.request(route))
      try client.check(response, data)
      return .done(pick(try JSONDecoder().decode(Body.self, from: data)))
    } catch let refused as FeedClient.Refused {
      return .refused(refused.message)
    } catch {
      return .refused(FeedStore.downReason(error))
    }
  }
}
