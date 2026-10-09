import Foundation
import Testing

@testable import Feed

@Suite("Add agent draft")
struct AddAgentDraftTests {
  private func draft(
    name: String = "web", role: String = "worker", instructions: String = "", folder: String? = "/tmp/web",
    agent: SpawnAgent = .claude
  ) -> AddAgentDraft {
    AddAgentDraft(name: name, role: role, instructions: instructions, folder: folder, agent: agent)
  }

  @Test("a full draft becomes the seat the spawn route takes")
  func seat() {
    let seat = draft(instructions: "  build the web side  ", agent: .codex).seat(taken: ["api"])

    #expect(
      seat
        == HumanSpawn(
          name: "web", role: "worker", cwd: "/tmp/web", instructions: "build the web side", model: nil, agent: .codex))
  }

  @Test("blank instructions are left out, so the daemon clears none")
  func blankInstructions() {
    #expect(draft(instructions: " \n ").seat(taken: [])?.instructions == nil)
  }

  @Test("no seat without a name or a folder", arguments: [("", "/tmp/web"), ("web", nil)] as [(String, String?)])
  func missing(name: String, folder: String?) {
    #expect(draft(name: name, folder: folder).seat(taken: []) == nil)
  }

  @Test("a bad or taken name says what is wrong and gives no seat")
  func badName() {
    #expect(draft(name: "Web").problem(taken: []) == "Use lowercase letters, numbers and dashes.")
    #expect(draft(name: "web").problem(taken: ["web"]) == "web is already in this room.")
    #expect(draft(name: "web").seat(taken: ["web"]) == nil)
    #expect(draft(name: "").problem(taken: []) == nil)
  }

  @Test("instructions count as the daemon counts them, in UTF-16 units")
  func emojiInstructions() {
    let long = draft(instructions: String(repeating: "🚀", count: 2001))

    #expect(long.problem(taken: []) == "Keep the instructions to 4,000 characters or fewer.")
    #expect(draft(instructions: String(repeating: "🚀", count: 2000)).problem(taken: []) == nil)
  }

  @Test("instructions past 4,000 characters say so and give no seat")
  func longInstructions() {
    let long = draft(instructions: String(repeating: "a", count: 4001))

    #expect(long.problem(taken: []) == "Keep the instructions to 4,000 characters or fewer.")
    #expect(long.seat(taken: []) == nil)
  }
}

@Suite("Launch pill")
struct LaunchPillTests {
  private func member(_ name: String, _ presence: Presence) -> Member {
    Member(
      roomId: "r1", name: name, kind: .claude, clientLabel: nil, clientName: nil, clientVersion: nil,
      presence: presence, role: "worker", cursor: 0, done: false, joinedAt: "t0", lastSeenAt: "t0", leftAt: nil)
  }

  @Test("an invited seat the app is still starting says starting")
  func starting() {
    #expect(member("web", .invited).launchPill(starting: ["web"]) == .starting)
  }

  @Test("an invited seat someone else started says invited")
  func invited() {
    #expect(member("web", .invited).launchPill(starting: ["api"]) == .invited)
  }

  @Test("a seated agent has no launch pill, even while its spawn answer is on its way")
  func seated() {
    #expect(member("web", .active).launchPill(starting: ["web"]) == nil)
    #expect(member("web", .idle).launchPill(starting: []) == nil)
  }
}

@Suite("Attach key")
struct AttachKeyTests {
  private func member(_ name: String, _ presence: Presence) -> Member {
    Member(
      roomId: "r1", name: name, kind: .claude, clientLabel: nil, clientName: nil, clientVersion: nil,
      presence: presence, role: "worker", cursor: 0, done: false, joinedAt: "t0", lastSeenAt: "t0", leftAt: nil)
  }

  @Test("an invited seat that sits down changes the key, so the attach lines load again")
  func seated() {
    #expect([member("web", .invited)].attachKey != [member("web", .active)].attachKey)
  }

  @Test("a seat that only goes idle keeps the key")
  func idle() {
    #expect([member("web", .active)].attachKey == [member("web", .idle)].attachKey)
  }
}

@Suite("Flock seat")
struct FlockSeatTests {
  @Test("the attach line names the session exactly, so tmux never picks another seat's by prefix")
  func attachLine() throws {
    let json = """
      {"seats":[{"agent":"claude","cwd":"/tmp/web","name":"web","pid":42,"presence":"active","process":"running",
      "role":"worker","room":"dev","session":"messhall_dev_web"}]}
      """
    let flock = try JSONDecoder().decode(Flock.self, from: Data(json.utf8))

    #expect(flock.seats.first?.attachLine == "tmux attach -t =messhall_dev_web")
  }

  @Test("only a seat whose agent still runs gives an attach line")
  func attachLines() throws {
    let seat = { (name: String, process: String) in
      FlockSeat(
        agent: "claude", cwd: "/tmp", name: name, pid: nil, presence: .active, process: process, role: "worker",
        room: "dev", session: "messhall_dev_\(name)")
    }
    let flock = Flock(seats: [seat("web", "running"), seat("api", "gone")])

    #expect(flock.attachLines == ["web": "tmux attach -t =messhall_dev_web"])
  }
}
