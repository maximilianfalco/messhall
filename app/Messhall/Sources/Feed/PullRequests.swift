import Foundation
import Observation

/// A GitHub pull request named by a link in a chat line.
public struct PullRequestLink: Hashable, Sendable {
  public let owner: String
  public let repo: String
  public let number: Int

  public init(owner: String, repo: String, number: Int) {
    self.owner = owner
    self.repo = repo
    self.number = number
  }

  public var url: URL { URL(string: "https://github.com/\(owner)/\(repo)/pull/\(number)")! }
  public var label: String { "\(owner)/\(repo) #\(number)" }
}

/// Every pull request link in `text`, in order, each once.
public func pullRequestLinks(in text: String) -> [PullRequestLink] {
  let pattern = /https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/pull\/(\d+)/
  var seen = Set<PullRequestLink>()
  return text.matches(of: pattern).compactMap { match in
    guard let number = Int(match.3) else { return nil }
    let link = PullRequestLink(owner: String(match.1), repo: String(match.2), number: number)
    return seen.insert(link).inserted ? link : nil
  }
}

/// The cards under one chat line: the first few links, then how many more there are.
public struct PullRequestRow: Equatable, Sendable {
  public static let limit = 3

  public let shown: [PullRequestLink]
  public let more: Int

  public init(shown: [PullRequestLink], more: Int) {
    self.shown = shown
    self.more = more
  }

  public init(links: [PullRequestLink]) {
    self.init(shown: Array(links.prefix(Self.limit)), more: max(0, links.count - Self.limit))
  }
}

public enum PullRequestState: String, Sendable {
  case open, draft, merged, closed
}

public enum CIState: String, Sendable {
  case passing, failing, running, none
}

/// What a card shows about one pull request.
public struct PullRequestCard: Equatable, Sendable {
  public static let humanVetoLabel = "human veto"

  public let link: PullRequestLink
  public let title: String
  public let state: PullRequestState
  public let ci: CIState
  public let humanVeto: Bool

  public init(link: PullRequestLink, title: String, state: PullRequestState, ci: CIState, humanVeto: Bool) {
    self.link = link
    self.title = title
    self.state = state
    self.ci = ci
    self.humanVeto = humanVeto
  }

  /// Reads the JSON of `gh pr view --json title,state,isDraft,labels,statusCheckRollup`. Nil when it is not that.
  public init?(link: PullRequestLink, ghJSON: Data) {
    guard let view = try? JSONDecoder().decode(GHPullRequest.self, from: ghJSON) else { return nil }
    let state: PullRequestState? =
      switch view.state {
      case "OPEN": view.isDraft ? .draft : .open
      case "MERGED": .merged
      case "CLOSED": .closed
      default: nil
      }
    guard let state else { return nil }
    self.init(
      link: link, title: view.title, state: state, ci: ciState(view.statusCheckRollup ?? []),
      humanVeto: (view.labels ?? []).contains { $0.name == Self.humanVetoLabel })
  }
}

/// The fields of `gh pr view --json` a card reads.
struct GHPullRequest: Decodable {
  struct Label: Decodable { let name: String }

  /// A check run has `status` and `conclusion`, an old style commit status has `state`.
  struct Check: Decodable {
    let status: String?
    let conclusion: String?
    let state: String?
  }

  let title: String
  let state: String
  let isDraft: Bool
  let labels: [Label]?
  let statusCheckRollup: [Check]?
}

private let failedConclusions: Set = ["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]
private let failedStates: Set = ["FAILURE", "ERROR"]
private let runningStates: Set = ["PENDING", "EXPECTED"]

/// One failed check fails the run. Else one unfinished check keeps it running.
func ciState(_ checks: [GHPullRequest.Check]) -> CIState {
  guard !checks.isEmpty else { return .none }
  let failed = checks.contains {
    failedConclusions.contains($0.conclusion ?? "") || failedStates.contains($0.state ?? "")
  }
  if failed { return .failing }
  let running = checks.contains {
    ($0.status.map { $0 != "COMPLETED" } ?? false) || runningStates.contains($0.state ?? "")
  }
  return running ? .running : .passing
}

/// The cards read so far, by link. A card is read again once older than `freshFor`, however often it is drawn.
@MainActor
@Observable
public final class PullRequestStore {
  public typealias Read = @MainActor (PullRequestLink) async -> PullRequestCard?

  /// Long enough that every row naming one PR shares one read when a room opens.
  public static let freshFor: TimeInterval = 30
  /// How often a card on screen is read again.
  public static let refreshEvery: Duration = .seconds(120)

  private var cards: [PullRequestLink: PullRequestCard] = [:]
  @ObservationIgnored private var readAt: [PullRequestLink: Date] = [:]
  @ObservationIgnored private let read: Read

  public init(read: @escaping Read) {
    self.read = read
  }

  public func card(for link: PullRequestLink) -> PullRequestCard? { cards[link] }

  /// Reads the card unless it was read less than `freshFor` ago. A failed read keeps the last card.
  public func refresh(_ link: PullRequestLink, now: Date = .now) async {
    if let last = readAt[link], now.timeIntervalSince(last) < Self.freshFor { return }
    // Marked before the read, so a second card for the same link waits instead of reading too.
    readAt[link] = now
    if let card = await read(link) { cards[link] = card }
  }
}
