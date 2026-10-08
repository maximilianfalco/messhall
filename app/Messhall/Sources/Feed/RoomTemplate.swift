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

  /// The bots whose seat is not in the room yet.
  public func bots(notSeated seated: [String]) -> [Bot] {
    bots.filter { !seated.contains($0.name) }
  }

  /// The second button: one claude that plans and hands the human join lines to paste. It starts nothing itself.
  public static let bringInRunning = RoomTemplate(
    id: "bring-in",
    title: "Bring in my running agents",
    blurb: "One helper plans your rooms and gives you a line to paste into each session. Nothing is started for you.",
    room: "home",
    topic: "Sorting the sessions on this Mac into rooms",
    bots: [
      Bot(
        name: "concierge",
        role: "worker",
        instructions: """
          Help the human put the Claude sessions they already run into rooms. You cannot start or type into \
          another session, and you must not read session files.
          Ask the human which projects they work on. Post a plan: one room per project, with its topic. For \
          each room give two lines the human pastes themselves, the launch line `messhall claude --room <room>` \
          for a new session, and the join prompt for one already running: Join the messhall room #<room> with \
          the messhall MCP tools: call join (room "<room>", as a short name you pick for yourself from the work you own), then call wait.
          Use ask_human to get the okay on the plan, then create nothing else. Warn that a session that already \
          reports to another tool may get confused about where to post.
          """
      )
    ]
  )
}
