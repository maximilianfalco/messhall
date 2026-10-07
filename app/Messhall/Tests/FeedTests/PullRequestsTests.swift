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
    let names = labels.joined(separator: ",")
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

  @Test func readsEveryLabelWithItsColor() {
    let labels = [
      #"{"id":"LA_1","name":"human veto","description":"waits","color":"B60205"}"#,
      #"{"id":"LA_2","name":"app","description":"","color":"fbca04"}"#,
    ]

    #expect(
      card(pr(labels: labels))?.labels == [
        PullRequestLabel(name: "human veto", color: LabelColor(red: 0xB6, green: 0x02, blue: 0x05)),
        PullRequestLabel(name: "app", color: LabelColor(red: 0xFB, green: 0xCA, blue: 0x04)),
      ])
  }

  @Test func aLabelWithABadColorHasNone() {
    let labels = [#"{"name":"odd","color":"zzz"}"#, #"{"name":"bare"}"#]

    #expect(
      card(pr(labels: labels))?.labels == [
        PullRequestLabel(name: "odd", color: nil), PullRequestLabel(name: "bare", color: nil),
      ])
  }

  @Test func noLabelsIsAnEmptyList() {
    #expect(card(pr())?.labels == [])
    #expect(card(#"{"title":"x","state":"OPEN","isDraft":false}"#)?.labels == [])
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

@Suite("pull request labels")
struct PullRequestLabelTests {
  private func labels(_ count: Int) -> [PullRequestLabel] {
    (0..<count).map { PullRequestLabel(name: "label \($0)", color: nil) }
  }

  @Test func showsTheFirstFewThenCountsTheRest() {
    let limit = LabelRow.limit

    #expect(LabelRow(labels: []) == LabelRow(shown: [], more: 0))
    #expect(LabelRow(labels: labels(1)) == LabelRow(shown: labels(1), more: 0))
    #expect(LabelRow(labels: labels(limit)) == LabelRow(shown: labels(limit), more: 0))
    #expect(LabelRow(labels: labels(limit + 3)) == LabelRow(shown: labels(limit), more: 3))
  }

  @Test func darkTextOnLightColorsAndLightTextOnDarkOnes() {
    #expect(LabelColor(red: 0xFB, green: 0xCA, blue: 0x04).wantsDarkText)
    #expect(LabelColor(red: 0xFF, green: 0xFF, blue: 0xFF).wantsDarkText)
    #expect(!LabelColor(red: 0xB6, green: 0x02, blue: 0x05).wantsDarkText)
    #expect(!LabelColor(red: 0x00, green: 0x52, blue: 0xCC).wantsDarkText)
  }
}

@Suite("pull request store")
@MainActor
struct PullRequestStoreTests {
  private static let link = PullRequestLink(owner: "acme", repo: "shop", number: 1)
  private static let start = Date(timeIntervalSince1970: 1_000)

  private static func open(_ title: String) -> PullRequestCard {
    PullRequestCard(link: link, title: title, state: .open, ci: .running, labels: [])
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
