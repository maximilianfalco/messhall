import Feed
import SwiftUI

/// Samples the cpu and memory of each agent session on this Mac, but only while the Processes tab is open.
@MainActor @Observable
final class ProcessWatch {
  static let sampleEvery = Duration.seconds(2)
  // The daemon's scan runs ps, lsof and git, so the agent list is asked for less often than usage.
  static let scanEvery: TimeInterval = 10

  private(set) var rows: [AgentProcessRow] = []
  private(set) var sampledAt = Date.now
  private(set) var loaded = false
  private(set) var refusal: String?
  private var agents: [RunningAgent] = []
  private var scannedAt: Date?
  private var previous: ProcessSample?

  func follow(_ client: FeedClient) async {
    // A sample from before the tab closed would average cpu over the whole gap.
    previous = nil
    while !Task.isCancelled {
      await tick(client)
      try? await Task.sleep(for: Self.sampleEvery)
    }
  }

  private func tick(_ client: FeedClient) async {
    if scannedAt.map({ Date.now.timeIntervalSince($0) >= Self.scanEvery }) ?? true {
      switch await HumanSeat(client: client).running() {
      case .done(let found):
        agents = found.agents
        scannedAt = .now
        loaded = true
        refusal = nil
      case .refused(let reason):
        refusal = reason
      }
    }
    guard loaded else { return }
    let roots = agents.compactMap { $0.pid.map(Int32.init) }
    let current = await Task.detached { ProcessProbe.sample(roots: roots) }.value
    rows = AgentProcesses.rows(agents: agents, previous: previous, current: current)
    sampledAt = current.at
    previous = current
  }
}

/// Which list the inspector shows.
enum InspectorTab: String, CaseIterable {
  case agents = "Agents"
  case processes = "Processes"
}

/// The Agents panel and the Processes tab, one picker above both.
struct InspectorView: View {
  let panel: AgentsPanel
  let client: FeedClient
  let processes: ProcessWatch
  @Bindable var navigation: Navigation

  var body: some View {
    VStack(spacing: 0) {
      Picker("Show", selection: $navigation.inspectorTab) {
        ForEach(InspectorTab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
      }
      .pickerStyle(.segmented)
      .labelsHidden()
      .padding(.horizontal, 12)
      .padding(.top, 8)
      switch navigation.inspectorTab {
      case .agents:
        AgentsView(panel: panel, navigation: navigation)
          .frame(maxHeight: .infinity)
      case .processes:
        ProcessesView(watch: processes)
          .frame(maxHeight: .infinity)
          .task { await processes.follow(client) }
      }
    }
  }
}

/// One row per claude or codex session on this Mac, its children's cpu and memory billed to it.
struct ProcessesView: View {
  let watch: ProcessWatch

  var body: some View {
    if !watch.loaded, let refusal = watch.refusal {
      ContentUnavailableView(
        "Can't List Agents", systemImage: "exclamationmark.triangle", description: Text(refusal))
    } else if !watch.loaded {
      ProgressView()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    } else if watch.rows.isEmpty {
      ContentUnavailableView(
        "No Agents Running", systemImage: "cpu",
        description: Text("Claude Code and Codex sessions on this Mac show here."))
    } else {
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 6) {
          ForEach(watch.rows) { ProcessRowView(row: $0, now: watch.sampledAt) }
        }
        .padding(12)
      }
    }
  }
}

struct ProcessRowView: View {
  let row: AgentProcessRow
  let now: Date

  private var agent: RunningAgent { row.agent }

  private var folder: String {
    let name = agent.repo ?? URL(fileURLWithPath: agent.cwd).lastPathComponent
    return agent.branch.map { "\(name) · \($0)" } ?? name
  }

  private var details: [String] {
    var parts: [String] = []
    if let tmux = agent.tmux { parts.append("tmux \(tmux)") }
    if let started = row.started { parts.append("up \(AgentProcesses.uptime(now.timeIntervalSince(started)))") }
    if row.processes > 1 { parts.append("\(row.processes) processes") }
    if agent.pid == nil { parts.append("runs in the shared codex server") }
    return parts
  }

  private var cpu: String { row.cpu.map { String(format: "%.1f%%", $0) } ?? "–" }

  private var memory: String {
    row.memory.map { ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .memory) } ?? "–"
  }

  var body: some View {
    HStack(alignment: .top, spacing: 8) {
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 5) {
          Text(agent.kind.rawValue)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(.quaternary, in: Capsule())
          Text(folder)
            .font(.callout.weight(.medium))
            .lineLimit(1)
            .truncationMode(.middle)
        }
        Text(AgentProcesses.seatLine(agent))
          .font(.caption)
          .foregroundStyle(agent.seats.isEmpty ? .tertiary : .secondary)
          .lineLimit(2)
        if !details.isEmpty {
          Text(details.joined(separator: " · "))
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(2)
        }
      }
      Spacer(minLength: 4)
      VStack(alignment: .trailing, spacing: 2) {
        Text(cpu)
          .font(.callout.monospacedDigit())
        Text(memory)
          .font(.caption.monospacedDigit())
          .foregroundStyle(.secondary)
      }
      .fixedSize()
    }
    .help(agent.cwd)
    .padding(.horizontal, 10)
    .padding(.vertical, 8)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(agent.kind.rawValue) in \(folder), \(AgentProcesses.seatLine(agent)), cpu \(cpu), memory \(memory)")
  }
}
