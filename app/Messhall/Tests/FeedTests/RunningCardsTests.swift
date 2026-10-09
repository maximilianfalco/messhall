import Testing

@testable import Feed

private func agent(_ id: String, kind: String = "claude", room: String? = nil) -> RunningAgent {
  RunningAgent(
    branch: "rm-7/x", cwd: "/code/\(id)", id: id, kind: kind, reach: kind == "claude" ? "claude_session" : "codex_thread",
    repo: id, room: room, status: "idle")
}

private func running(_ agents: [RunningAgent], ids: [String]? = nil) -> Running {
  Running(agents: agents, suggestions: [RoomSuggestion(ids: ids ?? agents.map(\.id), key: "rm-7", room: "rm-7")])
}

@Suite("RunningCard")
struct RunningCardsTests {
  @Test("counts each kind and offers to make the room")
  func makeRoom() {
    let cards = RunningCard.cards(
      running: running([agent("a"), agent("b"), agent("c", kind: "codex")]), openRooms: [], dismissed: [])

    #expect(cards.map(\.title) == ["2 claude + 1 codex on rm-7"])
    #expect(cards.map(\.action) == [.make("rm-7")])
    #expect(cards.first?.invitees.map(\.id) == ["a", "b", "c"])
  }

  @Test("offers to invite when the room is already open, leaving out who sits in it")
  func inviteToOpenRoom() {
    let cards = RunningCard.cards(
      running: running([agent("a", room: "rm-7"), agent("b")]), openRooms: ["rm-7"], dismissed: [])

    #expect(cards.map(\.action) == [.invite("rm-7")])
    #expect(cards.first?.title == "1 claude on rm-7")
    #expect(cards.first?.invitees.map(\.id) == ["b"])
  }

  @Test("hides a card the human said not now to, until its agents change")
  func notNow() {
    let first = running([agent("a"), agent("b")])
    let dismissed: Set = [RunningCard.cards(running: first, openRooms: [], dismissed: []).first!.dismissKey]

    #expect(RunningCard.cards(running: first, openRooms: [], dismissed: dismissed).isEmpty)
    #expect(RunningCard.cards(running: running([agent("a"), agent("c")]), openRooms: [], dismissed: dismissed).count == 1)
  }

  @Test("drops a card with nobody left to invite")
  func nobodyLeft() {
    let cards = RunningCard.cards(
      running: running([agent("a", room: "rm-7"), agent("b", room: "rm-7")]), openRooms: ["rm-7"], dismissed: [])

    #expect(cards.isEmpty)
  }
}
