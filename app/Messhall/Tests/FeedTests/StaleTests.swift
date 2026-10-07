import Foundation
import Testing

@testable import Feed

@MainActor
@Suite("Stale side")
struct StaleTests {
  private let older = Build(commit: String(repeating: "a", count: 40), committedAt: "2026-10-07T01:00:00Z")
  private let newer = Build(commit: String(repeating: "b", count: 40), committedAt: "2026-10-07T08:00:00Z")

  private func side(_ contract: Int?, _ build: Build?, app: Build?) -> StaleSide {
    StaleSide.of(contract: contract, build: build, appContract: 5, appBuild: app)
  }

  @Test("the contract decides first")
  func contract() {
    #expect(side(4, newer, app: older) == .daemon)
    #expect(side(6, older, app: newer) == .app)
  }

  @Test("a daemon with no contract or no build stamp is the older one")
  func unstamped() {
    #expect(side(nil, nil, app: newer) == .daemon)
    #expect(side(5, nil, app: newer) == .daemon)
  }

  @Test("on the same contract the older commit time is the stale side")
  func commitTime() {
    #expect(side(5, older, app: newer) == .daemon)
    #expect(side(5, newer, app: older) == .app)
  }

  @Test("a stamp with millis compares with one without")
  func millis() {
    let daemon = Build(commit: newer.commit, committedAt: "2026-10-07T08:00:00.000Z")

    #expect(side(5, daemon, app: older) == .app)
  }

  @Test("each side names its own fix")
  func reasons() {
    #expect(StaleSide.daemon.reason == "The daemon is older than this app. Run messhall start.")
    #expect(StaleSide.app.reason == "This app is older than the daemon. Run make app.")
  }

  @Test("a snapshot the app cannot read still says which side is older")
  func unreadableSnapshot() {
    let store = FeedStore()
    store.appBuild = newer
    let current = FeedContract.version
    let body = #"{"contract_version": \#(current), "build": {"commit": "x", "committed_at": "2026-10-07T01:00:00Z"}, "rooms": 3}"#

    #expect(store.downPhase(SnapshotLoader.decode(Data(body.utf8))) == .outdated(.daemon))
    #expect(store.downPhase(SnapshotLoader.decode(Data(#"{"contract_version": \#(current + 1)}"#.utf8))) == .outdated(.app))
    #expect(store.downPhase(SnapshotLoader.decode(Data(#"{"rooms": 3}"#.utf8))) == .outdated(.daemon))
  }

  @Test("a readable feed with an older daemon commit shows no notice")
  func readableOlderCommit() throws {
    let store = FeedStore()
    store.appBuild = newer
    var snapshot = try Fixture.decode(Snapshot.self, "Snapshot")
    snapshot.build = older
    store.apply(.snapshot(snapshot))

    #expect(store.stale == nil)
  }

  @Test("an event the app cannot read is judged by the last snapshot's build")
  func unreadableEvent() throws {
    let store = FeedStore()
    store.appBuild = older
    var snapshot = try Fixture.decode(Snapshot.self, "Snapshot")
    snapshot.build = newer
    store.apply(.snapshot(snapshot))
    let error = DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "bad"))

    #expect(store.downPhase(error) == .outdated(.app))
  }

  @Test("the plist names the contract the app reads")
  func plist() throws {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().appendingPathComponent("../../Resources/Info.plist").standardized
    let plist = try #require(NSDictionary(contentsOf: url))

    #expect(plist["MesshallFeedContract"] as? Int == FeedContract.version)
  }
}

private extension SnapshotLoader {
  static func decode(_ data: Data) -> Error {
    do {
      _ = try read(data)
      return CancellationError()
    } catch {
      return error
    }
  }
}
