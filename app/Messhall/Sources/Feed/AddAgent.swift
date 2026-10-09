import Foundation

/// What the human typed in the Add Agent sheet, checked as they type.
public struct AddAgentDraft: Equatable, Sendable {
  public static let roles = ["worker", "reviewer", "orchestrator", "observer"]
  static let instructionsMax = 4000

  public var name: String
  public var role: String
  public var instructions: String
  public var folder: String?
  public var agent: SpawnAgent

  public init(
    name: String = "", role: String = "worker", instructions: String = "", folder: String? = nil,
    agent: SpawnAgent = .claude
  ) {
    self.name = name
    self.role = role
    self.instructions = instructions
    self.folder = folder
    self.agent = agent
  }

  private var trimmedInstructions: String { instructions.trimmingCharacters(in: .whitespacesAndNewlines) }

  /// What is wrong, or nil. An empty name has nothing to show yet.
  public func problem(taken: [String]) -> String? {
    if let bad = RoomName.problem(name, taken: []) { return bad }
    if taken.contains(name) { return "\(name) is already in this room." }
    if trimmedInstructions.count > Self.instructionsMax { return "Keep the instructions to 4,000 characters or fewer." }
    return nil
  }

  /// The seat for the spawn route, or nil while the draft is not ready.
  public func seat(taken: [String]) -> HumanSpawn? {
    guard !name.isEmpty, let folder, problem(taken: taken) == nil else { return nil }
    let instructions = trimmedInstructions
    return HumanSpawn(
      name: name, role: role, cwd: folder, instructions: instructions.isEmpty ? nil : instructions, model: nil,
      agent: agent)
  }
}

/// The pill on a seat whose agent has not sat down yet.
public enum LaunchPill: String, Sendable {
  /// The app asked for it and waits for the agent.
  case starting
  /// Someone else started it.
  case invited
}

extension Member {
  /// Starting while the app's own spawn waits on this seat, invited for anyone else's. Nil once the agent sits down.
  public func launchPill(starting: Set<String>) -> LaunchPill? {
    guard presence == .invited else { return nil }
    return starting.contains(name) ? .starting : .invited
  }
}

extension FlockSeat {
  // `=` makes tmux match the whole name, so `web` never attaches to `web-2`.
  public var attachLine: String { "tmux attach -t =\(session)" }
}

extension Flock {
  /// The attach line for each seat whose agent still runs, by seat name.
  public var attachLines: [String: String] {
    Dictionary(seats.filter { $0.process == "running" }.map { ($0.name, $0.attachLine) }) { first, _ in first }
  }
}
