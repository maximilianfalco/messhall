import Feed
import SwiftUI

/// The toolbar button that shows or hides the Agents panel, with how many agents are working.
struct AgentsButton: View {
  let working: Int
  let navigation: Navigation

  var body: some View {
    Button {
      navigation.showsAgents.toggle()
    } label: {
      Label("\(working) working", systemImage: "person.2")
        .labelStyle(.titleAndIcon)
    }
    .help(navigation.showsAgents ? "Hide Agents" : "Show Agents")
    .accessibilityLabel("Agents, \(working) working")
  }
}

/// Every agent in every room. A click opens the agent's room at its last post.
struct AgentsView: View {
  let panel: AgentsPanel
  let navigation: Navigation
  @State private var showsFolded = Self.startsOpen

  #if DEBUG
    private static let startsOpen = ShotHooks.openFolds
  #else
    private static let startsOpen = false
  #endif

  var body: some View {
    if panel.shown.isEmpty, panel.folded.isEmpty {
      ContentUnavailableView(
        "No Agents", systemImage: "person.2", description: Text("Agents show here once they join a room."))
    } else {
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 6) {
          ForEach(panel.shown) { row(for: $0) }
          if !panel.folded.isEmpty {
            FoldedAgents(count: panel.folded.count, open: showsFolded) {
              withAnimation(.snappy) { showsFolded.toggle() }
            }
            if showsFolded {
              ForEach(panel.folded) { row(for: $0).opacity(0.6) }
            }
          }
        }
        .padding(12)
      }
    }
  }

  private func row(for agent: AgentRow) -> some View {
    AgentRowView(agent: agent) { navigation.reveal(agent) }
  }
}

struct AgentRowView: View {
  let agent: AgentRow
  let open: () -> Void
  @State private var hovering = false

  // Off in Settings, the row has no PR to read, so nothing goes to GitHub.
  private var pullRequests: PullRequestRow {
    let link = AppSettings.shared.snapshot.pullRequestCards ? agent.pullRequest : nil
    return PullRequestRow(links: link.map { [$0] } ?? [])
  }

  var body: some View {
    let member = agent.member
    let pullRequests = pullRequests
    VStack(alignment: .leading, spacing: 8) {
      Button(action: open) {
        HStack(alignment: .top, spacing: 8) {
          AvatarView(name: member.name, size: 26, presence: member.presence, done: member.done)
          VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 5) {
              Text(member.name)
                .font(.callout.weight(.medium))
              Text("#\(agent.room)")
                .font(.caption)
                .foregroundStyle(.secondary)
              if let role = member.rolePill {
                RolePill(role: role)
              }
            }
            .lineLimit(1)
            if member.status != nil {
              StatusLine(member: member, maxWidth: .infinity)
            }
          }
          Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .help("Open #\(agent.room) at \(member.name)'s last post")
      .accessibilityElement(children: .ignore)
      .accessibilityLabel("\(member.spokenLabel(as: member.name)), in \(agent.room)")
      .accessibilityHint("Opens #\(agent.room) at its last post")
      PullRequestCards(row: pullRequests, showsLabels: false)
        .padding(.leading, 34)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .readsPullRequests(pullRequests)
    .padding(.horizontal, 10)
    .padding(.vertical, 8)
    .background(.quaternary.opacity(hovering ? 0.9 : 0.5), in: RoundedRectangle(cornerRadius: 8))
    .onHover { hovering = $0 }
  }
}

/// The done and away agents as one line. A click shows or hides them under it.
struct FoldedAgents: View {
  let count: Int
  let open: Bool
  let toggle: () -> Void

  var body: some View {
    Button(action: toggle) {
      HStack(spacing: 4) {
        Image(systemName: "chevron.right")
          .imageScale(.small)
          .rotationEffect(.degrees(open ? 90 : 0))
        Text("\(count) done or away")
      }
      .font(.caption)
      .foregroundStyle(.secondary)
      .padding(.horizontal, 10)
      .padding(.vertical, 4)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel("\(count) done or away")
    .accessibilityValue(open ? "Expanded" : "Collapsed")
  }
}
