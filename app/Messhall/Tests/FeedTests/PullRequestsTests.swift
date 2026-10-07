import Foundation
import Testing

@testable import Feed

@Suite("pull request links")
struct PullRequestLinkTests {
  @Test func findsOneLink() {
    let links = pullRequestLinks(in: "ready for review: https://github.com/acme/shop/pull/84 @reviewer-1")

    #expect(links == [PullRequestLink(owner: "acme", repo: "shop", number: 84)])
    #expect(links.first?.url.absoluteString == "https://github.com/acme/shop/pull/84")
    #expect(links.first?.label == "acme/shop #84")
  }

  @Test func findsSeveralInOrderOnce() {
    let text = "merged https://github.com/acme/shop/pull/2, then https://github.com/acme/web/pull/7/files and again "
      + "https://github.com/acme/shop/pull/2."

    #expect(
      pullRequestLinks(in: text) == [
        PullRequestLink(owner: "acme", repo: "shop", number: 2),
        PullRequestLink(owner: "acme", repo: "web", number: 7),
      ])
  }

  @Test func skipsLinksThatAreNotPullRequests() {
    let text = "see https://github.com/acme/shop/issues/3, https://github.com/acme/shop and "
      + "https://gitlab.com/acme/shop/pull/4 or https://github.com/acme/shop/pull/abc"

    #expect(pullRequestLinks(in: text).isEmpty)
  }

  @Test func showsThreeThenCountsTheRest() {
    let links = (1...5).map { PullRequestLink(owner: "acme", repo: "shop", number: $0) }

    #expect(PullRequestRow(links: links) == PullRequestRow(shown: Array(links.prefix(3)), more: 2))
    #expect(PullRequestRow(links: Array(links.prefix(2))) == PullRequestRow(shown: Array(links.prefix(2)), more: 0))
  }
}

@Suite("pull request cards")
struct PullRequestCardTests {
  private static let link = PullRequestLink(owner: "acme", repo: "shop", number: 9)

  private func card(_ json: String) -> PullRequestCard? {
    PullRequestCard(link: Self.link, ghJSON: Data(json.utf8))
  }

  private func check(_ status: String, _ conclusion: String) -> String {
    #"{"__typename":"CheckRun","status":"\#(status)","conclusion":"\#(conclusion)"}"#
  }

  private func pr(state: String = "OPEN", draft: Bool = false, labels: [String] = [], checks: [String] = []) -> String {
    let names = labels.map { #"{"name":"\#($0)"}"# }.joined(separator: ",")
    return #"{"title":"Add the cart total","state":"\#(state)","isDraft":\#(draft),"labels":[\#(names)],"#
      + #""statusCheckRollup":[\#(checks.joined(separator: ","))]}"#
  }

  @Test func readsTitleAndState() {
    #expect(card(pr())?.title == "Add the cart total")
    #expect(card(pr())?.state == .open)
    #expect(card(pr(draft: true))?.state == .draft)
    #expect(card(pr(state: "MERGED"))?.state == .merged)
    #expect(card(pr(state: "CLOSED"))?.state == .closed)
  }

  @Test func humanVetoComesFromItsLabel() {
    #expect(card(pr(labels: ["human veto", "app"]))?.humanVeto == true)
    #expect(card(pr(labels: ["app"]))?.humanVeto == false)
  }

  @Test func ciFailsWhenAnyCheckFails() {
    let checks = [
      check("COMPLETED", "SUCCESS"), check("IN_PROGRESS", ""), check("COMPLETED", "FAILURE"),
    ]
    #expect(card(pr(checks: checks))?.ci == .failing)
    #expect(card(pr(checks: [#"{"__typename":"StatusContext","state":"ERROR"}"#]))?.ci == .failing)
  }

  @Test func ciRunsWhileAnyCheckIsUnfinished() {
    #expect(card(pr(checks: [check("COMPLETED", "SUCCESS"), check("QUEUED", "")]))?.ci == .running)
    #expect(card(pr(checks: [#"{"__typename":"StatusContext","state":"PENDING"}"#]))?.ci == .running)
  }

  @Test func ciPassesWhenEveryCheckFinishedClean() {
    #expect(card(pr(checks: [check("COMPLETED", "SUCCESS"), check("COMPLETED", "SKIPPED")]))?.ci == .passing)
    #expect(card(pr(checks: [#"{"__typename":"StatusContext","state":"SUCCESS"}"#]))?.ci == .passing)
  }

  @Test func noChecksIsNoCI() {
    #expect(card(pr())?.ci == CIState.none)
  }

  @Test func unreadableAnswerIsNoCard() {
    #expect(card("") == nil)
    #expect(card(#"{"message":"Not Found"}"#) == nil)
    #expect(card(#"{"title":"x","state":"REOPENED_SOMEHOW","isDraft":false}"#) == nil)
  }
}

@Suite("pull request store")
@MainActor
struct PullRequestStoreTests {
  private static let link = PullRequestLink(owner: "acme", repo: "shop", number: 1)
  private static let start = Date(timeIntervalSince1970: 1_000)

  private static func open(_ title: String) -> PullRequestCard {
    PullRequestCard(link: link, title: title, state: .open, ci: .running, humanVeto: false)
  }

  @Test func showsTheCardOnceRead() async {
    let store = PullRequestStore { _ in Self.open("first") }

    await store.refresh(Self.link, now: Self.start)

    #expect(store.card(for: Self.link)?.title == "first")
  }

  @Test func anUnreadableLinkHasNoCard() async {
    let store = PullRequestStore { _ in nil }

    await store.refresh(Self.link, now: Self.start)

    #expect(store.card(for: Self.link) == nil)
  }

  @Test func readsAgainOnceNoLongerFresh() async {
    var reads = 0
    let store = PullRequestStore { _ in
      reads += 1
      return Self.open("read \(reads)")
    }

    await store.refresh(Self.link, now: Self.start)
    await store.refresh(Self.link, now: Self.start.addingTimeInterval(PullRequestStore.freshFor - 1))
    #expect(reads == 1)

    await store.refresh(Self.link, now: Self.start.addingTimeInterval(PullRequestStore.freshFor))
    #expect(reads == 2)
    #expect(store.card(for: Self.link)?.title == "read 2")
  }

  @Test func aFailedReadKeepsTheLastCard() async {
    var answer: PullRequestCard? = Self.open("good")
    let store = PullRequestStore { _ in answer }

    await store.refresh(Self.link, now: Self.start)
    answer = nil
    await store.refresh(Self.link, now: Self.start.addingTimeInterval(PullRequestStore.freshFor))

    #expect(store.card(for: Self.link)?.title == "good")
  }
}

@Suite("pull request refresh")
@MainActor
struct PullRequestRefreshTests {
  private static let link = PullRequestLink(owner: "acme", repo: "shop", number: 1)
  private static let other = PullRequestLink(owner: "acme", repo: "shop", number: 2)

  private static func card(_ state: PullRequestState, _ ci: CIState, link: PullRequestLink = link) -> PullRequestCard {
    PullRequestCard(link: link, title: "x", state: state, ci: ci, humanVeto: false)
  }

  @Test func runningChecksRefreshSoon() {
    #expect(Self.card(.open, .running).refreshAfter == PullRequestCard.refreshSoon)
    #expect(Self.card(.draft, .running).refreshAfter == PullRequestCard.refreshSoon)
  }

  @Test func openWithNoChecksYetRefreshesSoon() {
    #expect(Self.card(.open, .none).refreshAfter == PullRequestCard.refreshSoon)
  }

  @Test func settledChecksRefreshSlowly() {
    #expect(Self.card(.open, .passing).refreshAfter == PullRequestCard.refreshLater)
    #expect(Self.card(.open, .failing).refreshAfter == PullRequestCard.refreshLater)
  }

  @Test func mergedAndClosedStop() {
    #expect(Self.card(.merged, .passing).refreshAfter == nil)
    #expect(Self.card(.closed, .running).refreshAfter == nil)
  }

  @Test func aRowRefreshesAtItsSoonestCard() async {
    let store = PullRequestStore { $0 == Self.link ? Self.card(.open, .passing) : Self.card(.open, .running, link: Self.other) }

    await store.refresh(Self.link)
    await store.refresh(Self.other)

    #expect(store.refreshAfter([Self.link, Self.other]) == PullRequestCard.refreshSoon)
  }

  @Test func aRowOfFinishedPullRequestsStops() async {
    let store = PullRequestStore { Self.card(.merged, .passing, link: $0) }

    await store.refresh(Self.link)
    await store.refresh(Self.other)

    #expect(store.refreshAfter([Self.link, Self.other]) == nil)
  }

  @Test func anUnreadCardKeepsTryingSlowly() async {
    let store = PullRequestStore { _ in nil }

    await store.refresh(Self.link)

    #expect(store.refreshAfter([Self.link]) == PullRequestCard.refreshLater)
  }
}

@Suite("gh runner")
struct GHRunnerTests {
  @Test func aHungGhIsKilledAtTheTimeoutWhileOtherReadsRun() async {
    let hung = ProcessInfo.processInfo.activeProcessorCount * 3
    let start = ContinuousClock.now

    let (quick, quickAt, hungResults) = await withTaskGroup(of: Data?.self) { group in
      for _ in 0..<hung {
        group.addTask { await runGH("/bin/sleep", ["30"], timeout: .seconds(1)) }
      }
      try? await Task.sleep(for: .milliseconds(200))
      let quick = await runGH("/bin/echo", ["hi"], timeout: .seconds(1))
      let quickAt = ContinuousClock.now - start
      var results: [Data?] = []
      for await result in group { results.append(result) }
      return (quick, quickAt, results)
    }

    #expect(quick == Data("hi\n".utf8))
    #expect(quickAt < .seconds(1))
    #expect(hungResults.count == hung)
    #expect(hungResults.allSatisfy { $0 == nil })
    #expect(ContinuousClock.now - start < .seconds(5))
  }
}
