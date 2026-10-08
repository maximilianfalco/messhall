import Foundation

public enum RoomAction: Sendable {
  case create(NewRoom)
  case close(String)
  case reopen(String)
}

extension FeedStore {
  static let retryDelay = Duration.seconds(2)

  /// Loads the snapshot, then follows the event stream, retrying every 2 s while the daemon is down.
  /// Each reconnect loads the snapshot again, so the down banner clears the moment the daemon answers.
  public func run(_ client: FeedClient) async {
    while !Task.isCancelled {
      do {
        apply(.snapshot(try await SnapshotLoader(client: client).load()))
        liveSince = Date()
        for try await update in EventStream(client: client).updates(after: seq) {
          setPhase(.live)
          if let update { apply(update) }
        }
      } catch {
        setPhase(downPhase(error))
      }
      try? await Task.sleep(for: Self.retryDelay)
    }
  }

  /// Loads one older page of a room and puts it above the loaded lines. A failed load just ends, so the next scroll retries.
  public func loadOlder(room: String, via client: FeedClient) async {
    guard let before = beginLoadingOlder(room) else { return }
    do {
      let request = try client.request(.history(room: room, before: before, limit: Paging.pageSize))
      let (data, response) = try await client.session.data(for: request)
      try client.check(response, data)
      let page = try JSONDecoder().decode(History.self, from: data).messages
      // A snapshot in between may have moved the top, and this page would then leave a gap.
      guard self.room(named: room)?.oldestLoadedId == before else { return endLoadingOlder(room) }
      prepend(page, to: room)
    } catch {
      endLoadingOlder(room)
    }
  }

  /// Posts as the human and shows the message at once. Returns the refusal text, or nil.
  public func post(_ text: String, room: String, via client: FeedClient) async -> String? {
    switch await HumanSeat(client: client).post(room: room, text: text) {
    case .done(let message):
      add(message, to: room)
      return nil
    case .refused(let reason):
      return reason
    }
  }

  /// Sets a member's role as the human and shows it at once. Returns the refusal text, or nil.
  public func setRole(_ role: String, member: String, room: String, via client: FeedClient) async -> String? {
    switch await HumanSeat(client: client).setRole(role, member: member, room: room) {
    case .done(let result):
      add(result, to: room)
      return nil
    case .refused(let reason):
      return reason
    }
  }

  /// Removes left or away members as the human, one by one, and takes each out at once. Returns the first refusal, or nil.
  public func remove(_ members: [String], room: String, via client: FeedClient) async -> String? {
    let seat = HumanSeat(client: client)
    for name in members {
      switch await seat.remove(member: name, room: room) {
      case .done(let member): drop(member, from: room)
      case .refused(let reason): return reason
      }
    }
    return nil
  }

  /// Mutes or unmutes a member as the human and shows it at once. Returns the refusal text, or nil.
  public func mute(_ member: String, muted: Bool, room: String, via client: FeedClient) async -> String? {
    switch await HumanSeat(client: client).mute(member, muted: muted, room: room) {
    case .done(let member):
      add(member, change: muted ? .muted : .unmuted, to: room)
      return nil
    case .refused(let reason):
      return reason
    }
  }

  /// Allows or denies an agent's tool ask as the human and takes its card away at once. Returns the refusal text, or nil.
  public func answer(_ approval: Approval, allow: Bool, via client: FeedClient) async -> String? {
    switch await HumanSeat(client: client).answer(approval, allow: allow) {
    case .done(let approvals):
      settle(approvals)
      return nil
    case .refused(let reason):
      return reason
    }
  }

  /// Picks an option on an agent's question as the human and takes its card away at once.
  /// Returns the refusal text, or nil.
  public func answer(_ question: Question, option: Int, via client: FeedClient) async -> String? {
    switch await HumanSeat(client: client).answer(question, option: option) {
    case .done(let result):
      settle(result)
      return nil
    case .refused(let reason):
      return reason
    }
  }

  /// Makes, closes or reopens a room as the human and shows it at once. Returns the refusal text, or nil.
  public func change(_ action: RoomAction, via client: FeedClient) async -> String? {
    let seat = HumanSeat(client: client)
    let outcome =
      switch action {
      case .create(let room): await seat.create(room)
      case .close(let room): await seat.close(room: room)
      case .reopen(let room): await seat.reopen(room: room)
      }
    switch outcome {
    case .done(let room):
      add(room)
      return nil
    case .refused(let reason):
      return reason
    }
  }

  /// Makes the template's room unless `room` already exists, then starts the bots not seated in it, one by one in
  /// `folder`. Returns the room's name and the refusal text, if any. A failed bot stops the rest and the room stays.
  public func start(
    _ template: RoomTemplate, in folder: String, room existing: String?, via client: FeedClient
  ) async -> (room: String, refusal: String?) {
    let seat = HumanSeat(client: client)
    let name = existing ?? template.roomName(taken: rooms.map(\.name))
    if existing == nil {
      switch await seat.create(NewRoom(name: name, topic: template.topic)) {
      case .refused(let reason): return (name, reason)
      case .done(let room): add(room)
      }
    }
    let seated = room(named: name)?.members.map(\.name) ?? []
    for bot in template.bots(notSeated: seated) {
      let spawn = HumanSpawn(
        name: bot.name, role: bot.role, cwd: folder, instructions: bot.instructions, model: bot.model)
      if case .refused(let reason) = await seat.spawn(spawn, room: name) { return (name, "\(bot.name): \(reason)") }
    }
    return (name, nil)
  }

  /// A snapshot it cannot read is judged by its own version fields, an event by the last snapshot's.
  func downPhase(_ error: Error) -> Phase {
    let side = { StaleSide.of(contract: $0, build: $1, appContract: self.builtContract, appBuild: self.appBuild) }
    switch error {
    case let unreadable as UnreadableSnapshot: return .outdated(side(unreadable.contractVersion, unreadable.build))
    case is DecodingError: return .outdated(side(contractVersion, build))
    default: return .down(Self.downReason(error))
    }
  }

  /// A reply the app cannot read has no version fields to judge, so it points at messhall status.
  nonisolated static func downReason(_ error: Error) -> String {
    switch error {
    case is DecodingError: "The app and the daemon run different versions. Run messhall status."
    case is FeedClient.KeyMissing: "No human key yet."
    case let refused as FeedClient.Refused: refused.message
    default: "Messhall is not running."
    }
  }
}
