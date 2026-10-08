import Foundation
import Testing

@testable import Feed

@Suite("RoomTemplate")
struct RoomTemplateTests {
  private static let shipped = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("Resources/Templates")

  private func template(room: String = "review", bots: [RoomTemplate.Bot] = []) -> RoomTemplate {
    RoomTemplate(id: "t", title: "T", blurb: "b", room: room, topic: "x", bots: bots)
  }

  @Test("three templates ship: a review pair, a research desk and a daily helper")
  func shipsThree() {
    let templates = RoomTemplate.load(from: Self.shipped)

    #expect(templates.map(\.id) == ["review-pair", "research-desk", "daily-helper"])
  }

  @Test("every shipped template has a valid room, valid bot names and instructions the daemon accepts")
  func shippedAreValid() {
    for template in RoomTemplate.load(from: Self.shipped) {
      #expect(RoomName.isValid(template.room, taken: []))
      #expect(!template.bots.isEmpty)
      #expect(Set(template.bots.map(\.name)).count == template.bots.count)
      for bot in template.bots {
        #expect(RoomName.isValid(bot.name, taken: []))
        #expect(RoomName.isValid(bot.role, taken: []))
        #expect((1...4000).contains(bot.instructions.count))
      }
    }
  }

  @Test("the review pair gates the worker with an opus reviewer")
  func reviewPair() throws {
    let pair = try #require(RoomTemplate.load(from: Self.shipped).first { $0.id == "review-pair" })

    #expect(pair.bots.map(\.role) == ["worker", "reviewer"])
    #expect(pair.bots.last?.model == "opus")
  }

  @Test("a folder with no templates, or a file that is not one, loads nothing")
  func missingOrBroken() throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    #expect(RoomTemplate.load(from: dir).isEmpty)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    try "nope".write(to: dir.appendingPathComponent("a.json"), atomically: true, encoding: .utf8)
    #expect(RoomTemplate.load(from: dir).isEmpty)
  }

  @Test("a room name already taken gets the next free number")
  func roomNameTaken() {
    #expect(template().roomName(taken: ["dev"]) == "review")
    #expect(template().roomName(taken: ["review"]) == "review-2")
    #expect(template().roomName(taken: ["review", "review-2"]) == "review-3")
  }

  @Test("a long room name is cut so the number still fits in 40")
  func roomNameLong() {
    let long = String(repeating: "x", count: 40)
    let name = template(room: long).roomName(taken: [long])

    #expect(name.count == 40)
    #expect(name.hasSuffix("-2"))
  }

  @Test("bring in my agents is one claude that plans first and waits for the human")
  func bringIn() {
    let bot = RoomTemplate.bringInRunning.bots

    #expect(bot.count == 1)
    #expect(RoomName.isValid(RoomTemplate.bringInRunning.room, taken: []))
    #expect(bot[0].instructions.contains("plan"))
    #expect(bot[0].instructions.contains("messhall claude --room"))
    #expect(!bot[0].instructions.localizedCaseInsensitiveContains("invite"))
    #expect(!bot[0].instructions.contains(".claude/projects"))
    #expect((1...4000).contains(bot[0].instructions.count))
  }

  @Test("bots already seated in the room are skipped, so a second Start adds only the missing ones")
  func pendingBots() {
    let bots = ["worker", "reviewer"].map { RoomTemplate.Bot(name: $0, role: $0, instructions: "x") }
    let pair = template(bots: bots)

    #expect(pair.bots(notSeated: []).map(\.name) == ["worker", "reviewer"])
    #expect(pair.bots(notSeated: ["worker"]).map(\.name) == ["reviewer"])
    #expect(pair.bots(notSeated: ["worker", "reviewer", "human"]).isEmpty)
  }
}
