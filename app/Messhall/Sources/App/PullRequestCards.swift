import Feed
import SwiftUI

/// A card under a chat line for each PR it links, at most three, then "and N more".
/// A link whose PR cannot be read gets no card, so it stays plain text.
struct PullRequestCards: View {
  let row: PullRequestRow
  @Environment(PullRequestStore.self) private var store

  var body: some View {
    let cards = row.shown.compactMap(store.card(for:))
    if !cards.isEmpty {
      VStack(alignment: .leading, spacing: 4) {
        ForEach(cards, id: \.link) { PullRequestCardView(card: $0) }
        if row.more > 0 {
          Text("and \(row.more) more")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      }
    }
  }
}

extension View {
  /// Reads the row's PRs while the line is on screen: once when it shows, then every couple of minutes.
  func readsPullRequests(_ row: PullRequestRow) -> some View {
    modifier(ReadPullRequests(links: row.shown))
  }
}

private struct ReadPullRequests: ViewModifier {
  let links: [PullRequestLink]
  @Environment(PullRequestStore.self) private var store

  func body(content: Content) -> some View {
    content.task(id: links) {
      guard !links.isEmpty else { return }
      while !Task.isCancelled {
        for link in links { await store.refresh(link) }
        try? await Task.sleep(for: PullRequestStore.refreshEvery)
      }
    }
  }
}

struct PullRequestCardView: View {
  let card: PullRequestCard
  @State private var hovering = false
  @Environment(\.openURL) private var openURL

  var body: some View {
    Button { openURL(card.link.url) } label: {
      HStack(alignment: .top, spacing: 8) {
        Image(systemName: card.state.symbol)
          .foregroundStyle(card.state.color)
          .frame(width: 16)
        VStack(alignment: .leading, spacing: 3) {
          Text(card.title)
            .fontWeight(.medium)
            .lineLimit(1)
            .truncationMode(.tail)
          HStack(spacing: 8) {
            Text(card.link.label)
            Text(card.state.title).foregroundStyle(card.state.color)
            if let ci = card.ci.label {
              Label(ci, systemImage: card.ci.symbol)
                .foregroundStyle(card.ci.color)
            }
            if card.humanVeto { HumanVetoPill() }
          }
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(1)
        }
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 7)
      .frame(maxWidth: 460, alignment: .leading)
      .background(.quaternary.opacity(hovering ? 0.9 : 0.5), in: RoundedRectangle(cornerRadius: 8))
      .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.separator))
      .contentShape(RoundedRectangle(cornerRadius: 8))
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
    .help("Open \(card.link.url.absoluteString)")
    .accessibilityLabel(spoken)
    .accessibilityHint("Opens the pull request in your browser")
  }

  private var spoken: String {
    [card.title, card.link.label, card.state.title, card.ci.label, card.humanVeto ? "human veto" : nil]
      .compactMap { $0 }.joined(separator: ", ")
  }
}

/// Says the PR waits for the owner to merge it.
private struct HumanVetoPill: View {
  var body: some View {
    Label("human veto", systemImage: "hand.raised.fill")
      .fixedSize()
      .foregroundStyle(.orange)
      .padding(.horizontal, 6)
      .padding(.vertical, 1)
      .background(.orange.opacity(0.12), in: Capsule())
  }
}

extension PullRequestState {
  var title: String {
    switch self {
    case .open: "Open"
    case .draft: "Draft"
    case .merged: "Merged"
    case .closed: "Closed"
    }
  }

  var symbol: String {
    switch self {
    case .open, .draft: "arrow.triangle.pull"
    case .merged: "arrow.triangle.merge"
    case .closed: "xmark.circle"
    }
  }

  var color: Color {
    switch self {
    case .open: .green
    case .draft: .secondary
    case .merged: .purple
    case .closed: .red
    }
  }
}

extension CIState {
  /// Nil for a PR with no checks, so the card says nothing about CI.
  var label: String? {
    switch self {
    case .passing: "Checks passing"
    case .failing: "Checks failing"
    case .running: "Checks running"
    case .none: nil
    }
  }

  var symbol: String {
    switch self {
    case .passing: "checkmark.circle.fill"
    case .failing: "xmark.circle.fill"
    case .running: "clock.fill"
    case .none: ""
    }
  }

  var color: Color {
    switch self {
    case .passing: .green
    case .failing: .red
    case .running: .orange
    case .none: .secondary
    }
  }
}
