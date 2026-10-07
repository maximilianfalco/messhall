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

/// A label's color, from GitHub's six digit hex.
public struct LabelColor: Equatable, Sendable {
  public let red: Double
  public let green: Double
  public let blue: Double

  /// Takes 0 to 255 per channel.
  public init(red: Int, green: Int, blue: Int) {
    self.red = Double(red) / 255
    self.green = Double(green) / 255
    self.blue = Double(blue) / 255
  }

  /// Nil when `hex` is not six hex digits.
  public init?(hex: String) {
    guard hex.count == 6, hex.allSatisfy(\.isHexDigit), let value = Int(hex, radix: 16) else { return nil }
    self.init(red: value >> 16 & 0xFF, green: value >> 8 & 0xFF, blue: value & 0xFF)
  }

  /// True when black text on this color reads better than white, by WCAG contrast.
  public var wantsDarkText: Bool {
    func linear(_ c: Double) -> Double { c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
    let luminance = 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
    // Black wins once (L + 0.05) / 0.05 beats 1.05 / (L + 0.05), which is at L of about 0.179.
    return luminance > 0.179
  }
}

public struct PullRequestLabel: Equatable, Sendable {
  public let name: String
  /// Nil when GitHub sent no usable color, so the pill falls back to a plain one.
  public let color: LabelColor?

  public init(name: String, color: LabelColor?) {
    self.name = name
    self.color = color
  }
}

/// The pills on one card: the first few labels, then how many more there are.
public struct LabelRow: Equatable, Sendable {
  public static let limit = 2

  public let shown: [PullRequestLabel]
  public let more: Int

  public init(shown: [PullRequestLabel], more: Int) {
    self.shown = shown
    self.more = more
  }

  public init(labels: [PullRequestLabel]) {
    self.init(shown: Array(labels.prefix(Self.limit)), more: max(0, labels.count - Self.limit))
  }
}

/// What a card shows about one pull request.
public struct PullRequestCard: Equatable, Sendable {
  public let link: PullRequestLink
  public let title: String
  public let state: PullRequestState
  public let ci: CIState
  public let labels: [PullRequestLabel]

  public init(link: PullRequestLink, title: String, state: PullRequestState, ci: CIState, labels: [PullRequestLabel]) {
    self.link = link
    self.title = title
    self.state = state
    self.ci = ci
    self.labels = labels
  }

  public static let refreshSoon: Duration = .seconds(30)
  public static let refreshLater: Duration = .seconds(120)

  /// When to read the PR again. Soon while checks may still change, never once it is merged or closed.
  public var refreshAfter: Duration? {
    switch (state, ci) {
    case (.merged, _), (.closed, _): nil
    case (_, .running), (_, .none): Self.refreshSoon
    default: Self.refreshLater
    }
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
      labels: (view.labels ?? []).map { PullRequestLabel(name: $0.name, color: $0.color.flatMap(LabelColor.init(hex:))) })
  }
}

/// The fields of `gh pr view --json` a card reads.
struct GHPullRequest: Decodable {
  struct Label: Decodable {
    let name: String
    let color: String?
  }

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

  private var cards: [PullRequestLink: PullRequestCard] = [:]
  @ObservationIgnored private var readAt: [PullRequestLink: Date] = [:]
  @ObservationIgnored private let read: Read

  public init(read: @escaping Read) {
    self.read = read
  }

  public func card(for link: PullRequestLink) -> PullRequestCard? { cards[link] }

  /// When a row of links should be read again: at its soonest card. Nil once every PR is merged or closed.
  /// A link with no card yet keeps trying slowly, since gh may be missing or logged out.
  public func refreshAfter(_ links: [PullRequestLink]) -> Duration? {
    links.compactMap { cards[$0].map(\.refreshAfter) ?? PullRequestCard.refreshLater }.min()
  }

  /// Reads the card unless it was read less than `freshFor` ago. A failed read keeps the last card.
  public func refresh(_ link: PullRequestLink, now: Date = .now) async {
    if let last = readAt[link], now.timeIntervalSince(last) < Self.freshFor { return }
    // Marked before the read, so a second card for the same link waits instead of reading too.
    readAt[link] = now
    if let card = await read(link) { cards[link] = card }
  }
}
