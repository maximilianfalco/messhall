import Feed
import SwiftUI

struct NewRoomSheet: View {
  let store: FeedStore
  let client: FeedClient
  let navigation: Navigation
  @State private var name: String
  @State private var topic = ""
  @State private var selected: String?
  @State private var orchestrator: Bool
  @State private var folder: URL?
  @State private var startedRoom: String?
  @State private var choosingFolder = false
  @State private var creating = false
  @State private var refusal: String?
  @Environment(\.dismiss) private var dismiss

  init(store: FeedStore, client: FeedClient, navigation: Navigation) {
    self.store = store
    self.client = client
    self.navigation = navigation
    let shotTemplate = RoomTemplate.templates.first { $0.id == navigation.newRoomTemplate }
    let draft = shotTemplate?.draft(taken: store.rooms.map(\.name))
    _selected = State(initialValue: shotTemplate?.id)
    _orchestrator = State(initialValue: navigation.newRoomOrchestrator && RoomTemplate.shippedOrchestrator != nil)
    _name = State(initialValue: draft?.name ?? navigation.newRoomDraft ?? "")
    _topic = State(initialValue: draft?.topic ?? "")
  }

  private var taken: [String] { store.rooms.map(\.name) }
  private var problem: String? { startedRoom == nil ? RoomName.problem(name, taken: taken) : nil }
  private var template: RoomTemplate? { RoomTemplate.templates.first { $0.id == selected } }
  private var lead: RoomTemplate.Bot? { orchestrator ? RoomTemplate.shippedOrchestrator : nil }
  private var launch: RoomTemplate? {
    let base = template ?? (lead == nil ? nil : RoomTemplate.blank)
    guard let base, let lead else { return base }
    return base.adding(lead)
  }
  private var canCreate: Bool {
    let nameOk = startedRoom != nil || RoomName.isValid(name, taken: taken)
    return nameOk && (launch == nil || folder != nil) && !creating
  }

  var body: some View {
    VStack(spacing: 0) {
      Text("New Room")
        .font(.headline)
        .padding(.top, 20)
      form
    }
    .frame(width: 420)
    .fileImporter(isPresented: $choosingFolder, allowedContentTypes: [.folder]) { result in
      if case .success(let url) = result { folder = url }
    }
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
      if !RoomTemplate.templates.isEmpty { templatePicker }
      Section {
        TextField("Name", text: $name, prompt: Text("release-notes"))
          .disabled(startedRoom != nil)
          .onSubmit(create)
      } footer: {
        Text(problem ?? "Lowercase letters, numbers and dashes, up to \(RoomName.maxLength).")
          .foregroundStyle(problem == nil ? Color.secondary : Color.red)
      }
      Section {
        TextField("Topic", text: $topic, prompt: Text("Optional"))
      } footer: {
        Text("Agents come and go without closing it. It closes when you close it.")
          .foregroundStyle(.secondary)
      }
      if RoomTemplate.shippedOrchestrator != nil { orchestratorSwitch }
      if let launch { agentsSection(launch) }
      if let refusal {
        Text(refusal).foregroundStyle(.red)
      }
    }
    .formStyle(.grouped)
    .scrollDisabled(true)
  }

  private var templatePicker: some View {
    Section {
      Picker("Start from", selection: pick) {
        Text("Blank").tag(String?.none)
        ForEach(RoomTemplate.templates) { Text($0.title).tag(Optional($0.id)) }
      }
      if let template {
        Text(template.blurb).foregroundStyle(.secondary)
      }
    }
  }

  private var orchestratorSwitch: some View {
    Section {
      Toggle("Start an orchestrator", isOn: $orchestrator)
    } footer: {
      Text("It hands out roles and spawns agents in the room. It does not build or review.")
        .foregroundStyle(.secondary)
    }
  }

  private var pick: Binding<String?> {
    Binding(
      get: { selected },
      set: { id in
        selected = id
        startedRoom = nil
        let draft = RoomTemplate.templates.first { $0.id == id }?.draft(taken: taken)
        name = draft?.name ?? ""
        topic = draft?.topic ?? ""
      })
  }

  private func agentsSection(_ template: RoomTemplate) -> some View {
    Section {
      ForEach(template.bots, id: \.name) { bot in
        LabeledContent(bot.name, value: [bot.role, bot.model].compactMap { $0 }.joined(separator: ", "))
      }
      LabeledContent("Agents start in") {
        HStack {
          Text(folder?.path(percentEncoded: false) ?? "Pick a project folder")
            .foregroundStyle(folder == nil ? .tertiary : .primary)
            .lineLimit(1)
            .truncationMode(.middle)
          Button("Choose\u{2026}") { choosingFolder = true }
        }
      }
    } footer: {
      Text("Agents trust the folder they start in, so pick one project, not your home folder.")
        .foregroundStyle(.secondary)
    }
  }

  private func create() {
    guard canCreate else { return }
    let topic = topic.trimmingCharacters(in: .whitespacesAndNewlines)
    if let launch, let folder {
      start(launch.renamed(name, topic: topic), in: folder)
      return
    }
    let room = NewRoom(name: name, topic: topic.isEmpty ? nil : topic)
    creating = true
    Task {
      refusal = await store.change(.create(room), via: client)
      creating = false
      guard refusal == nil else { return }
      navigation.room = room.name
      dismiss()
    }
  }

  private func start(_ template: RoomTemplate, in folder: URL) {
    creating = true
    refusal = nil
    Task {
      let started = await store.start(
        template, in: folder.path(percentEncoded: false), room: startedRoom, via: client)
      startedRoom = started.room
      refusal = started.refusal
      creating = false
      guard refusal == nil else { return }
      navigation.room = started.room
      dismiss()
    }
  }
}
