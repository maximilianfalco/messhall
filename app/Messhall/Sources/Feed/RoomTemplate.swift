import Foundation

/// A room plus the helper bots that start in it. Read from plain json files, so a new one is just a new file.
public struct RoomTemplate: Codable, Equatable, Sendable, Identifiable {
  public struct Bot: Codable, Equatable, Sendable {
    public var name: String
    public var role: String
    public var model: String?
    public var instructions: String

    public init(name: String, role: String, model: String? = nil, instructions: String) {
      self.name = name
      self.role = role
      self.model = model
      self.instructions = instructions
    }
  }

  public var id: String
  public var title: String
  public var blurb: String
  public var room: String
  public var topic: String
  public var bots: [Bot]

  public init(id: String, title: String, blurb: String, room: String, topic: String, bots: [Bot]) {
    self.id = id
    self.title = title
    self.blurb = blurb
    self.room = room
    self.topic = topic
    self.bots = bots
  }

  /// The templates that ship inside the app bundle.
  public static let templates = load(from: (Bundle.main.resourceURL ?? Bundle.main.bundleURL).appendingPathComponent("Templates"))

  /// Every readable template in the folder, in file name order. A missing folder or a broken file gives none.
  public static func load(from folder: URL) -> [RoomTemplate] {
    let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
    return files
      .filter { $0.pathExtension == "json" }
      .sorted { $0.lastPathComponent < $1.lastPathComponent }
      .compactMap { try? JSONDecoder().decode(RoomTemplate.self, from: Data(contentsOf: $0)) }
  }

  /// The room name, or the first `name-2`, `name-3` ... that no room has yet.
  public func roomName(taken: [String]) -> String {
    guard taken.contains(room) else { return room }
    for number in 2... {
      let suffix = "-\(number)"
      let name = String(room.prefix(RoomName.maxLength - suffix.count)) + suffix
      if !taken.contains(name) { return name }
    }
    return room
  }

  /// The second button: one claude that plans first, then invites the sessions already running once the human okays it.
  public static let bringInRunning = RoomTemplate(
    id: "bring-in",
    title: "Bring in my running agents",
    blurb: "One helper looks at your Claude sessions and proposes rooms. Nothing starts until you say so.",
    room: "home",
    topic: "Sorting the sessions on this Mac into rooms",
    bots: [
      Bot(
        name: "concierge",
        role: "worker",
        instructions: """
          Find the Claude Code sessions on this Mac: live ones (tmux panes and terminals) and past ones \
          (folders under ~/.claude/projects). Group them into rooms by project folder.
          First post the plan here: each room, its topic and the sessions that would join it. Ask the human \
          with ask_human to okay it. Start nothing before the human says yes.
          After the okay, create each room with a topic and invite or start the sessions with the messhall \
          tools. Do not restart a session, so its history stays. Skip any session that already reports to \
          another tool, and say which ones you skipped.
          """
      )
    ]
  )
}
