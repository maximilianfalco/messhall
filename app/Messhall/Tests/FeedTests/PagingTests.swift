import Foundation
import Testing

@testable import Feed

private func line(_ id: Int, _ text: String = "hi", kind: MessageKind = .chat) -> Message {
  Message(
    id: id, roomId: "r1", from: kind == .system ? "messhall" : "api", kind: kind, text: text, mentions: [],
    createdAt: "2026-01-01T09:00:00.000Z")
}

private func room(first: Int?, ids: ClosedRange<Int>?) -> SnapshotRoom {
  SnapshotRoom(
    id: "r1", name: "long", topic: nil, createdAt: "2026-01-01T09:00:00.000Z", createdBy: "api", standing: false,
    closedAt: nil, messageCap: 200, messageCount: ids?.count ?? 0, firstMessageId: first, members: [],
    messages: ids.map { $0.map { line($0) } } ?? [])
}

@MainActor
private func store(_ rooms: SnapshotRoom...) -> FeedStore {
  let store = FeedStore()
  store.apply(.snapshot(Snapshot(seq: 1, rooms: rooms)))
  return store
}

@MainActor
@Suite("Paging")
struct PagingTests {
  @Test("a room has more when its first loaded message is above its first message")
  func hasMore() {
    #expect(room(first: 1, ids: 51...100).hasMore)
    #expect(room(first: 1, ids: 51...100).oldestLoadedId == 51)
    #expect(!room(first: 51, ids: 51...100).hasMore)
    #expect(!room(first: nil, ids: nil).hasMore)
    #expect(room(first: nil, ids: nil).oldestLoadedId == nil)
  }

  @Test("an older page goes above the loaded lines, oldest first, and ends hasMore at the first message")
  func prepend() {
    let feed = store(room(first: 1, ids: 51...100))

    feed.prepend((26...50).map { line($0) }, to: "long")
    #expect(feed.rooms[0].oldestLoadedId == 26)
    #expect(feed.rooms[0].hasMore)

    feed.prepend((1...25).map { line($0) }, to: "long")
    #expect(feed.rooms[0].messages.map(\.id) == Array(1...100))
    #expect(!feed.rooms[0].hasMore)
  }

  @Test("a page that overlaps the loaded lines adds each message once")
  func overlap() {
    let feed = store(room(first: 1, ids: 51...100))

    feed.prepend((40...60).map { line($0) }, to: "long")

    #expect(feed.rooms[0].messages.map(\.id) == Array(40...100))
  }

  @Test("an empty page ends paging so the top stops asking")
  func emptyPage() {
    let feed = store(room(first: 1, ids: 51...100))

    feed.prepend([], to: "long")

    #expect(!feed.rooms[0].hasMore)
  }

  @Test("loading marks the room until its page lands")
  func loading() {
    let feed = store(room(first: 1, ids: 51...100))

    #expect(feed.beginLoadingOlder("long") == 51)
    #expect(feed.loadingOlder.contains("long"))
    #expect(feed.beginLoadingOlder("long") == nil)

    feed.prepend((1...50).map { line($0) }, to: "long")
    #expect(!feed.loadingOlder.contains("long"))
  }

  @Test("loading never starts for a room with nothing older")
  func nothingOlder() {
    let feed = store(room(first: 51, ids: 51...100))

    #expect(feed.beginLoadingOlder("long") == nil)
    #expect(!feed.loadingOlder.contains("long"))
  }

  @Test("a failed page clears loading so the next scroll can try again")
  func failed() {
    let feed = store(room(first: 1, ids: 51...100))
    _ = feed.beginLoadingOlder("long")

    feed.endLoadingOlder("long")

    #expect(feed.beginLoadingOlder("long") == 51)
  }

  @Test("a new snapshot keeps older pages that join up with it")
  func snapshotKeepsJoinedPages() {
    let feed = store(room(first: 1, ids: 51...100))
    feed.prepend((1...50).map { line($0) }, to: "long")

    feed.apply(.snapshot(Snapshot(seq: 2, rooms: [room(first: 1, ids: 61...110)])))

    #expect(feed.rooms[0].messages.map(\.id) == Array(1...110))
  }

  @Test("a new snapshot drops older pages when a gap sits between them")
  func snapshotDropsGap() {
    let feed = store(room(first: 1, ids: 51...100))
    feed.prepend((1...50).map { line($0) }, to: "long")

    feed.apply(.snapshot(Snapshot(seq: 2, rooms: [room(first: 1, ids: 151...200)])))

    #expect(feed.rooms[0].messages.map(\.id) == Array(151...200))
  }

  @Test("the top asks for a page within one screen of it, while there is more and none is loading")
  func shouldLoad() {
    #expect(Paging.shouldLoad(visibleTop: 300, viewportHeight: 400, hasMore: true, loading: false))
    #expect(!Paging.shouldLoad(visibleTop: 500, viewportHeight: 400, hasMore: true, loading: false))
    #expect(!Paging.shouldLoad(visibleTop: 0, viewportHeight: 400, hasMore: false, loading: false))
    #expect(!Paging.shouldLoad(visibleTop: 0, viewportHeight: 400, hasMore: true, loading: true))
  }

  @Test("the anchor is the row that now holds the old first message")
  func anchor() {
    let before = (51...53).map { line($0) }
    let after = (49...50).map { line($0) } + before

    #expect(Paging.anchor(firstMessageId: 51, in: after.folded()) == 51)
  }

  @Test("the anchor follows a presence run that grew into the new page")
  func anchorInGrownFold() {
    let before = [line(51, "web left", kind: .system), line(52, "qa joined", kind: .system), line(53)]
    let after = [line(49), line(50, "api joined", kind: .system)] + before

    #expect(Paging.anchor(firstMessageId: 51, in: after.folded()) == 50)
  }

  @Test("the anchor is nil when the old first message is gone")
  func anchorMissing() {
    #expect(Paging.anchor(firstMessageId: 7, in: [line(8)].folded()) == nil)
  }

  @Test("the scroll aim puts the anchor row back the same distance from the top of the view")
  func aim() {
    #expect(Paging.aim(gap: 0, rowHeight: 40, viewportHeight: 440) == 0)
    #expect(Paging.aim(gap: -200, rowHeight: 40, viewportHeight: 440) == -0.5)
    #expect(Paging.aim(gap: 100, rowHeight: 40, viewportHeight: 440) == 0.25)
    #expect(Paging.aim(gap: 50, rowHeight: 440, viewportHeight: 440) == 0)
  }

  @Test("a prepended page keeps the last id, so the transcript does not follow to the end")
  func followIgnoresPrepend() {
    #expect(Follow.action(lastBefore: 100, lastAfter: 100, fromHuman: false, nearBottom: true) == .none)
  }

  @Test("an older page folds with the lines it lands on, and the newest run keeps its open state")
  func foldsAcrossPages() {
    let loaded = [line(51, "web left", kind: .system), line(52), line(53, "qa joined", kind: .system)]
    let page = [line(49), line(50, "api joined", kind: .system)]

    let items = (page + loaded).folded()

    #expect(items.map(\.id) == [49, 50, 52, 53])
    guard case .fold(let fold) = items[1] else { Issue.record("not a fold"); return }
    #expect(fold.messages.map(\.id) == [50, 51])
    #expect(!fold.startsOpen)
  }
}
