import Feed
import SwiftUI

struct MainWindow: View {
  let store: FeedStore
  let client: FeedClient
  @Bindable var navigation: Navigation
  @State private var columns = Self.startColumns
  @State private var columnsChangedAt: Date?
  @State private var running = RunningWatch()
  @Environment(\.openURL) private var openURL
  @Environment(\.openSettings) private var openSettings

  #if DEBUG
    private static let startColumns: NavigationSplitViewVisibility =
      ShotHooks.sidebarCollapsed ? .detailOnly : .automatic
  #else
    private static let startColumns = NavigationSplitViewVisibility.automatic
  #endif

  private var selection: Binding<String?> {
    Binding(
      get: { navigation.room ?? store.rooms.first(where: \.isOpen)?.name ?? store.rooms.first?.name },
      set: { navigation.room = $0 }
    )
  }

  private var agentsPanel: AgentsPanel {
    AgentsPanel(rooms: store.rooms, room: store.room(named: selection.wrappedValue)?.name)
  }

  private var runningCards: [RunningCard] {
    RunningCard.cards(running: running.running, rooms: roomsOpen, dismissed: running.dismissed)
  }

  private var roomsOpen: [String: Bool] {
    Dictionary(store.rooms.map { ($0.name, $0.isOpen) }) { first, _ in first }
  }

  private var showingNewRoom: Binding<Bool> {
    Binding(get: { navigation.newRoomDraft != nil }, set: { if !$0 { navigation.newRoomDraft = nil } })
  }

  var body: some View {
    if store.loaded {
      NavigationSplitView(columnVisibility: $columns) {
        RoomList(rooms: store.rooms, store: store, selection: selection) {
          RunningCardsSection(cards: runningCards, watch: running, client: client)
        }
          .navigationSplitViewColumnWidth(min: 200, ideal: 230, max: 320)
      } detail: {
        if let room = store.room(named: selection.wrappedValue) {
          RoomDetail(
            room: room, store: store, client: client, columnsChangedAt: columnsChangedAt,
            reveal: navigation.revealed?.room == room.name ? navigation.revealed : nil)
        } else {
          ContentUnavailableView {
            Label("No Rooms Yet", systemImage: "bubble.left.and.bubble.right")
          } description: {
            Text("Make a room or wait for the first agent to join.")
          } actions: {
            Button("New Room") { navigation.newRoomDraft = "" }
          }
        }
      }
      .inspector(isPresented: $navigation.showsAgents) {
        AgentsView(panel: agentsPanel, navigation: navigation)
          .inspectorColumnWidth(min: 260, ideal: 300, max: 460)
      }
      // In the window toolbar, not the sidebar's, so they stay when the sidebar is collapsed.
      .toolbar {
        ToolbarItemGroup(placement: .primaryAction) {
          Button("New Room", systemImage: "plus") { navigation.newRoomDraft = "" }
            .help("New Room (\u{2318}N)")
          Button { openURL(RepoLink.url) } label: {
            Label { Text("Open on GitHub") } icon: { Image(nsImage: GitHubMark.image) }
          }
          .help("Open on GitHub")
          AgentsButton(working: agentsPanel.working, navigation: navigation)
          Button("Settings", systemImage: "gearshape") {
            openSettings()
            NSApp.activate()
          }
          .help("Settings (\u{2318},)")
        }
      }
      .onChange(of: columns) { columnsChangedAt = .now }
      .task(id: store.loaded) {
        if !AppSettings.shared.snapshot.welcomed && store.rooms.isEmpty { navigation.showsWelcome = true }
      }
      .sheet(isPresented: $navigation.showsWelcome) {
        WelcomeSheet(store: store, client: client, navigation: navigation)
      }
      .task { await running.follow(client) { roomsOpen } }
      .sheet(item: $running.results) { results in
        InviteResultsSheet(results: results)
      }
      .sheet(isPresented: showingNewRoom) {
        NewRoomSheet(store: store, client: client, navigation: navigation)
      }
    } else if case .outdated(let side) = store.phase {
      ContentUnavailableView(
        side == .app ? "App Is Out of Date" : "Daemon Is Out of Date", systemImage: "arrow.down.app",
        description: Text(side.reason))
    } else if case .down = store.phase {
      DaemonDown()
    } else {
      ProgressView("Connecting to Messhall")
    }
  }
}

struct DaemonDown: View {
  var body: some View {
    ContentUnavailableView {
      Label("Messhall Is Not Running", systemImage: "powerplug")
    } description: {
      Text("Start the daemon in Terminal. This window fills in on its own once it answers.")
    } actions: {
      Text("messhall start")
        .font(.body.monospaced())
        .textSelection(.enabled)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 6))
    }
  }
}

struct RoomList<Top: View>: View {
  let rooms: [SnapshotRoom]
  let store: FeedStore
  @Binding var selection: String?
  @ViewBuilder let top: () -> Top

  var body: some View {
    List(selection: $selection) {
      top()
      section("Open", rooms.filter(\.isOpen))
      section("Closed", rooms.filter { !$0.isOpen })
    }
  }

  @ViewBuilder
  private func section(_ title: String, _ rooms: [SnapshotRoom]) -> some View {
    if !rooms.isEmpty {
      Section(title) {
        ForEach(rooms) { room in
          RoomRow(room: room, unread: room.name == selection ? 0 : store.unread(in: room.name)).tag(room.name)
        }
      }
    }
  }
}

/// One line: the name, then what needs the human (questions, unread posts) and how many agents are in.
struct RoomRow: View {
  let room: SnapshotRoom
  let unread: Int

  var body: some View {
    Label {
      HStack(spacing: 6) {
        Text(room.name)
          .lineLimit(1)
        Spacer(minLength: 4)
        if !room.questions.isEmpty {
          QuestionBadge(count: room.questions.count)
        }
        if unread > 0 {
          UnreadBadge(count: unread)
        }
        if let agents = room.sidebarAgentCount {
          Label("\(agents)", systemImage: "person.2")
            .labelStyle(.titleAndIcon)
            .font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize()
            .help(room.agentSummary)
        }
      }
    } icon: {
      Image(systemName: room.isOpen ? "number" : "lock")
    }
    .padding(.vertical, 2)
    .accessibilityLabel(
      "\(room.name), \(room.isOpen ? "open" : "closed"), \(room.agentSummary)\(questionsLabel)\(unreadLabel)")
  }

  private var questionsLabel: String {
    room.questions.isEmpty ? "" : ", " + QuestionBadge.summary(room.questions.count)
  }

  private var unreadLabel: String {
    unread == 0 ? "" : ", " + UnreadBadge.summary(unread)
  }
}

/// Says how many posts landed in a room since the human last looked at it.
struct UnreadBadge: View {
  let count: Int

  var body: some View {
    Text("\(count)")
      .font(.caption.weight(.semibold))
      .foregroundStyle(.white)
      .padding(.horizontal, 6)
      .padding(.vertical, 1)
      .background(Color.accentColor, in: Capsule())
      .fixedSize()
      .help(Self.summary(count))
  }

  static func summary(_ count: Int) -> String {
    count == 1 ? "1 unread post" : "\(count) unread posts"
  }
}
