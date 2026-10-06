import Feed
import SwiftUI

struct NewRoomSheet: View {
  static let defaultCap = 200

  let store: FeedStore
  let client: FeedClient
  let navigation: Navigation
  @State private var name: String
  @State private var topic = ""
  @State private var cap = defaultCap
  @State private var creating = false
  @State private var refusal: String?
  @Environment(\.dismiss) private var dismiss

  init(store: FeedStore, client: FeedClient, navigation: Navigation) {
    self.store = store
    self.client = client
    self.navigation = navigation
    _name = State(initialValue: navigation.newRoomDraft ?? "")
  }

  private var taken: [String] { store.rooms.map(\.name) }
  private var problem: String? { RoomName.problem(name, taken: taken) }
  private var canCreate: Bool { RoomName.isValid(name, taken: taken) && cap > 0 && !creating }

  var body: some View {
    VStack(spacing: 0) {
      Text("New Room")
        .font(.headline)
        .padding(.top, 20)
      form
    }
    .frame(width: 420)
    .toolbar {
      ToolbarItem(placement: .cancellationAction) {
        Button("Cancel") { dismiss() }
      }
      ToolbarItem(placement: .confirmationAction) {
        Button("Create Room", action: create)
          .keyboardShortcut(.defaultAction)
          .disabled(!canCreate)
      }
    }
  }

  private var form: some View {
    Form {
      Section {
        TextField("Name", text: $name, prompt: Text("release-notes"))
          .onSubmit(create)
      } footer: {
        Text(problem ?? "Lowercase letters, numbers and dashes, up to \(RoomName.maxLength).")
          .foregroundStyle(problem == nil ? Color.secondary : Color.red)
      }
      Section {
        TextField("Topic", text: $topic, prompt: Text("Optional"))
        TextField("Post Cap", value: $cap, format: .number)
      } footer: {
        Text("Agents come and go without closing it. It closes when you close it or it reaches the cap.")
          .foregroundStyle(.secondary)
      }
      if let refusal {
        Text(refusal).foregroundStyle(.red)
      }
    }
    .formStyle(.grouped)
    .scrollDisabled(true)
  }

  private func create() {
    guard canCreate else { return }
    let topic = topic.trimmingCharacters(in: .whitespacesAndNewlines)
    let room = NewRoom(name: name, topic: topic.isEmpty ? nil : topic, cap: cap)
    creating = true
    Task {
      refusal = await store.change(.create(room), via: client)
      creating = false
      guard refusal == nil else { return }
      navigation.room = room.name
      dismiss()
    }
  }
}
