import Testing

@testable import Feed

@Suite("Fold")
struct FoldTests {
  private func line(_ id: Int, _ text: String, kind: MessageKind = .system) -> Message {
    Message(
      id: id, roomId: "r1", from: kind == .system ? "messhall" : "api", kind: kind, text: text, mentions: [],
      createdAt: "2026-01-01T09:00:00.000Z")
  }

  private func shape(_ items: [TranscriptItem]) -> [String] {
    items.map {
      switch $0 {
      case .message(let message): "m\(message.id)"
      case .fold(let fold):
        "f" + fold.messages.map { String($0.id) }.joined(separator: ",") + (fold.startsOpen ? "+" : "")
      }
    }
  }

  @Test("a run of presence lines folds into one item")
  func run() {
    let messages = [
      line(1, "api joined"), line(2, "web joined"), line(3, "qa reconnected"), line(4, "hi", kind: .chat),
    ]
    #expect(shape(messages.folded()) == ["f1,2,3", "m4"])
  }

  @Test("chat, done and summary lines break a run", arguments: [MessageKind.chat, .done, .summary])
  func breaks(kind: MessageKind) {
    let messages = [
      line(1, "api joined"), line(2, "web left"), line(3, "x", kind: kind), line(4, "web is away"),
      line(5, "qa left: lunch"), line(6, "api reconnected"), line(7, "y", kind: kind),
    ]
    #expect(shape(messages.folded()) == ["f1,2", "m3", "f4,5,6", "m7"])
  }

  @Test("an away line folds, and so does a gone line from before seats persisted")
  func away() {
    let messages = [line(1, "api is away"), line(2, "web is gone"), line(3, "hi", kind: .chat)]
    #expect(shape(messages.folded()) == ["f1,2", "m3"])
  }

  @Test("a lone presence line stays a plain message")
  func lone() {
    let messages = [line(1, "hi", kind: .chat), line(2, "api joined"), line(3, "ok", kind: .chat)]
    #expect(shape(messages.folded()) == ["m1", "m2", "m3"])
  }

  @Test("the newest run starts open only when it has fewer than 3 lines")
  func newestShort() {
    let short = [
      line(1, "a joined"), line(2, "b joined"), line(3, "x", kind: .chat), line(4, "a left"), line(5, "b left"),
    ]
    #expect(shape(short.folded()) == ["f1,2", "m3", "f4,5+"])
    let long = short + [line(6, "c joined")]
    #expect(shape(long.folded()) == ["f1,2", "m3", "f4,5,6"])
  }

  @Test("a short run is not the newest once a chat line follows it")
  func shortThenChat() {
    let messages = [line(1, "a joined"), line(2, "b joined"), line(3, "x", kind: .chat)]
    #expect(shape(messages.folded()) == ["f1,2", "m3"])
  }

  @Test(
    "room lines are never folded and break the run",
    arguments: ["all done, room closed", "#checkout closed by the human", "#checkout reopened"])
  func keptOut(text: String) {
    let messages = [
      line(1, "a joined"), line(2, "b joined"), line(3, text), line(4, "a left"), line(5, "b left"),
      line(6, "c left"),
    ]
    #expect(shape(messages.folded()) == ["f1,2", "m3", "f4,5,6"])
  }

  @Test("a fold keeps the id of its first line as the run grows")
  func stableIds() {
    let start = [line(1, "x", kind: .chat), line(7, "a joined"), line(9, "b joined"), line(12, "c joined")]
    let grown = start + [line(13, "d joined")]
    #expect(start.folded().map(\.id) == [1, 7])
    #expect(grown.folded().map(\.id) == [1, 7])
  }

  @Test("folding never drops a chat line, even next to a presence run")
  func keepsChat() {
    let messages = [
      line(1, "a left"), line(2, "how we doing", kind: .chat), line(3, "b reconnected"), line(4, "c joined"),
      line(5, "on it", kind: .chat), line(6, "c left"), line(7, "ok", kind: .chat), line(8, "d joined"),
    ]
    let shown = messages.folded().flatMap { item -> [Message] in
      switch item {
      case .message(let message): [message]
      case .fold(let fold): fold.messages
      }
    }

    #expect(shown == messages)
    #expect(shape(messages.folded()) == ["m1", "m2", "f3,4", "m5", "m6", "m7", "m8"])
  }

  @Test("an empty transcript has no items")
  func empty() {
    #expect([Message]().folded().isEmpty)
  }
}
