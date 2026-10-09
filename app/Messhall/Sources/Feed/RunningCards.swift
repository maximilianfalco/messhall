import Foundation

/// A suggestion the app shows: agents running on this Mac that may want one room, and what a click does.
public struct RunningCard: Equatable, Sendable, Identifiable {
  public enum Action: Equatable, Sendable {
    /// No such room yet, so the invite makes it.
    case make(String)
    case invite(String)

    public var room: String {
      switch self {
      case .make(let room), .invite(let room): room
      }
    }
  }

  public let action: Action
  public let invitees: [RunningAgent]
  public let key: String

  public var id: String { dismissKey }

  /// Changes when the agents on the card change, so a card the human set aside comes back for new ones.
  public var dismissKey: String { "\(key) \(invitees.map(\.id).sorted().joined(separator: ","))" }

  /// Like "2 claude + 1 codex on rm-7".
  public var title: String {
    let counts = [RunningKind.claude, .codex].compactMap { kind -> String? in
      let count = invitees.filter { $0.kind == kind }.count
      return count == 0 ? nil : "\(count) \(kind.rawValue)"
    }
    return "\(counts.joined(separator: " + ")) on \(key)"
  }

  /// One card per suggestion still worth showing: someone is left to invite, its room is not closed, and the
  /// human has not set it aside. `rooms` maps each known room to whether it is open.
  public static func cards(running: Running, rooms: [String: Bool], dismissed: Set<String>) -> [RunningCard] {
    let byID = Dictionary(running.agents.map { ($0.id, $0) }) { first, _ in first }
    return running.suggestions.compactMap { suggestion in
      let invitees = suggestion.ids.compactMap { byID[$0] }.filter { $0.room != suggestion.room }
      guard !invitees.isEmpty, rooms[suggestion.room] != false else { return nil }
      let action: Action = rooms[suggestion.room] == true ? .invite(suggestion.room) : .make(suggestion.room)
      let card = RunningCard(action: action, invitees: invitees, key: suggestion.key)
      return dismissed.contains(card.dismissKey) ? nil : card
    }
  }
}
