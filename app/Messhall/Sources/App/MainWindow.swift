import Feed
import SwiftUI

struct MainWindow: View {
  let store: FeedStore
  let client: FeedClient
  @Bindable var navigation: Navigation

  private var selection: Binding<String?> {
    Binding(
      get: { navigation.room ?? store.rooms.first(where: \.isOpen)?.name ?? store.rooms.first?.name },
      set: { navigation.room = $0 }
    )
  }

  var body: some View {
    if store.loaded {
      NavigationSplitView {
        RoomList(rooms: store.rooms, selection: selection)
          .navigationSplitViewColumnWidth(min: 200, ideal: 230)
      } detail: {
        if let room = store.room(named: selection.wrappedValue) {
          RoomDetail(room: room, store: store, client: client)
        } else {
          ContentUnavailableView(
            "No Rooms Yet", systemImage: "bubble.left.and.bubble.right",
            description: Text("A room appears here when the first agent joins it."))
        }
      }
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
