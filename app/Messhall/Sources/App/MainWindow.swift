import Feed
import SwiftUI

struct MainWindow: View {
  let store: FeedStore
  let client: FeedClient
  @Bindable var navigation: Navigation
  @State private var columns = NavigationSplitViewVisibility.automatic
  @State private var columnsChangedAt: Date?
  @Environment(\.openURL) private var openURL

  private var selection: Binding<String?> {
    Binding(
      get: { navigation.room ?? store.rooms.first(where: \.isOpen)?.name ?? store.rooms.first?.name },
      set: { navigation.room = $0 }
    )
  }

  private var showingNewRoom: Binding<Bool> {
    Binding(get: { navigation.newRoomDraft != nil }, set: { if !$0 { navigation.newRoomDraft = nil } })
  }

  var body: some View {
    if store.loaded {
      NavigationSplitView(columnVisibility: $columns) {
        RoomList(rooms: store.rooms, selection: selection)
          .navigationSplitViewColumnWidth(min: 200, ideal: 230, max: 320)
          .toolbar {
            ToolbarItem {
              Button("New Room", systemImage: "plus") { navigation.newRoomDraft = "" }
                .help("New Room (\u{2318}N)")
            }
            ToolbarItem {
              Button { openURL(RepoLink.url) } label: {
                Label { Text("Open on GitHub") } icon: { GitHubMark().frame(width: 16, height: 16) }
              }
              .help("Open on GitHub")
            }
          }
      } detail: {
        if let room = store.room(named: selection.wrappedValue) {
          RoomDetail(room: room, store: store, client: client, columnsChangedAt: columnsChangedAt)
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
      .onChange(of: columns) { columnsChangedAt = .now }
      .sheet(isPresented: showingNewRoom) {
        NewRoomSheet(store: store, client: client, navigation: navigation)
      }
    } else if store.phase == .outdated {
      ContentUnavailableView(
        "App Is Out of Date", systemImage: "arrow.down.app", description: Text(FeedStore.outdatedReason))
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

struct RoomList: View {
  let rooms: [SnapshotRoom]
  @Binding var selection: String?

  var body: some View {
    List(selection: $selection) {
      section("Open", rooms.filter(\.isOpen))
      section("Closed", rooms.filter { !$0.isOpen })
    }
  }

  @ViewBuilder
  private func section(_ title: String, _ rooms: [SnapshotRoom]) -> some View {
    if !rooms.isEmpty {
      Section(title) {
        ForEach(rooms) { room in
          RoomRow(room: room).tag(room.name)
        }
      }
    }
  }
}

struct RoomRow: View {
  let room: SnapshotRoom

  var body: some View {
    Label {
      VStack(alignment: .leading, spacing: 1) {
        Text(room.name)
        Text(room.agentSummary)
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    } icon: {
      Image(systemName: room.isOpen ? "number" : "lock")
    }
    .padding(.vertical, 2)
    .accessibilityLabel("\(room.name), \(room.isOpen ? "open" : "closed"), \(room.agentSummary)")
  }
}
