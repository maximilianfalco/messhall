import Feed
import SwiftUI

/// Watches the agents running on this Mac and holds the cards the human set aside.
@MainActor @Observable
final class RunningWatch {
  static let every = Duration.seconds(60)

  var running = Running(agents: [], suggestions: [])
  var dismissed: Set<String> = []
  var results: InviteResults?
  var busy: String?

  /// Scans again every minute while the window is open. A refused scan keeps the last list.
  func follow(_ client: FeedClient) async {
    while !Task.isCancelled {
      await refresh(client)
      try? await Task.sleep(for: Self.every)
    }
  }

  func refresh(_ client: FeedClient) async {
    if case .done(let found) = await HumanSeat(client: client).running() { running = found }
  }

  /// Makes the room when it is missing, then invites the card's agents and shows what each one got.
  func act(_ card: RunningCard, client: FeedClient) async {
    busy = card.id
    defer { busy = nil }
    let seat = HumanSeat(client: client)
    if case .make(let room) = card.action, case .refused(let reason) = await seat.create(NewRoom(name: room, topic: nil)),
      !reason.contains("already exists")
    {
      results = InviteResults(room: room, invites: [], refusal: reason)
      return
    }
    switch await seat.invite(card.invitees.map(\.id), room: card.action.room) {
    case .done(let invites): results = InviteResults(room: card.action.room, invites: invites, refusal: nil)
    case .refused(let reason): results = InviteResults(room: card.action.room, invites: [], refusal: reason)
    }
    dismissed.insert(card.dismissKey)
    await refresh(client)
  }
}

struct InviteResults: Identifiable {
  let room: String
  let invites: [RunningInviteItem]
  let refusal: String?

  var id: String { room }
}

/// The suggestion cards at the top of the room list.
struct RunningCardsSection: View {
  let cards: [RunningCard]
  let watch: RunningWatch
  let client: FeedClient

  var body: some View {
    if !cards.isEmpty {
      Section("Running Agents") {
        ForEach(cards) { card in
          RunningCardRow(card: card, busy: watch.busy == card.id) {
            Task { await watch.act(card, client: client) }
          } notNow: {
            watch.dismissed.insert(card.dismissKey)
          }
        }
      }
    }
  }
}

/// "2 claude + 1 codex on rm-7, make #rm-7?" with Make Room or Invite, and Not Now.
struct RunningCardRow: View {
  let card: RunningCard
  let busy: Bool
  let act: () -> Void
  let notNow: () -> Void

  private var question: String {
    switch card.action {
    case .make(let room): "Make #\(room)?"
    case .invite(let room): "Invite to #\(room)?"
    }
  }

  private var actionTitle: String {
    if case .make = card.action { return "Make Room" }
    return "Invite"
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(card.title)
        .font(.callout.weight(.medium))
      Text(question)
        .font(.caption)
        .foregroundStyle(.secondary)
      Text(card.invitees.map { "\($0.kind) in \($0.repo ?? URL(fileURLWithPath: $0.cwd).lastPathComponent)" }.joined(separator: ", "))
        .font(.caption)
        .foregroundStyle(.secondary)
        .lineLimit(2)
      HStack(spacing: 8) {
        Button(actionTitle, action: act)
          .buttonStyle(.borderedProminent)
          .disabled(busy)
        Button("Not Now", action: notNow)
        if busy { ProgressView().controlSize(.small) }
      }
      .controlSize(.small)
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("\(card.title). \(question)")
  }
}

/// What each invite did. Queued lines wait in their codex thread, the rest get a line to paste.
struct InviteResultsSheet: View {
  let results: InviteResults
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Invited to #\(results.room)")
        .font(.headline)
      if let refusal = results.refusal {
        Text(refusal)
          .foregroundStyle(.red)
      }
      ForEach(results.invites) { invite in
        InviteResultRow(invite: invite)
      }
      HStack {
        Spacer()
        Button("Done") { dismiss() }
          .keyboardShortcut(.defaultAction)
      }
    }
    .padding(20)
    .frame(width: 460)
  }
}

struct InviteResultRow: View {
  let invite: RunningInviteItem
  @State private var copied = false

  private var summary: String {
    let name = invite.name ?? invite.id
    switch invite.outcome {
    case "queued": return "\(name): the invite waits in its codex thread"
    case "gone": return "\(invite.id) stopped running"
    default: return "\(name): paste this line into its session"
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(summary)
        .font(.callout)
      if invite.outcome == "copy", let line = invite.line {
        HStack(alignment: .top) {
          Text(line)
            .font(.caption.monospaced())
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
          Button(copied ? "Copied" : "Copy") {
            copyToPasteboard(line)
            copied = true
            Task {
              try? await Task.sleep(for: copiedFor)
              copied = false
            }
          }
          .controlSize(.small)
        }
        .padding(6)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 6))
      }
    }
  }
}
