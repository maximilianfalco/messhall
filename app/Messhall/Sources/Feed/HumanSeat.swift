import Foundation

/// Acts as the human: posts messages, makes, closes and reopens rooms, sets roles, mutes members, removes them
/// and answers an agent's tool ask or question.
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

  public func remove(member: String, room: String) async -> Outcome<Member> {
    await send(.remove(room: room, member: member), as: RemoveMemberResult.self) { $0.member }
  }

  public func mute(_ member: String, muted: Bool, room: String) async -> Outcome<Member> {
    await send(.mute(room: room, member: member, muted: muted), as: MuteResult.self) { $0.member }
  }

  /// Starts an agent in a detached tmux session, seated in the room. Waits up to two minutes for its first call.
  public func spawn(_ seat: HumanSpawn, room: String) async -> Outcome<SpawnResult> {
    await send(.spawn(room: room, seat: seat), as: SpawnResult.self) { $0 }
  }

  /// The seats the spawner started in the room, with their tmux sessions.
  public func flock(room: String) async -> Outcome<Flock> {
    await send(.flock(room: room), as: Flock.self) { $0 }
  }

  /// The claude and codex sessions running on this Mac, and the rooms they may want.
  public func running() async -> Outcome<Running> {
    await send(.running, as: Running.self) { $0 }
  }

  /// Invites running agents to a room: queued on a shared codex thread, a line to copy for the rest.
  public func invite(_ ids: [String], room: String) async -> Outcome<[RunningInviteItem]> {
    await send(.inviteRunning(RunningInvite(ids: ids, room: room)), as: RunningInviteResult.self) { $0.invites }
  }

  public func answer(_ approval: Approval, allow: Bool) async -> Outcome<[Approval]> {
    await send(.answer(approval: approval.id, allow: allow), as: ApprovalResult.self) { $0.approvals }
  }

  public func answer(_ question: Question, with answers: [QuestionAnswer]) async -> Outcome<AnswerResult> {
    await send(.pick(question: question.id, answers: answers), as: AnswerResult.self) { $0 }
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
