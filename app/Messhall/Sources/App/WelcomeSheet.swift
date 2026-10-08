import Feed
import SwiftUI

struct WelcomeSheet: View {
  let store: FeedStore
  let client: FeedClient
  let navigation: Navigation
  @State private var selected = RoomTemplate.templates.first?.id
  @State private var folder: URL?
  @State private var startedRoom: String?
  @State private var choosingFolder = false
  @State private var starting = false
  @State private var refusal: String?
  @Environment(\.dismiss) private var dismiss

  private var template: RoomTemplate? { RoomTemplate.templates.first { $0.id == selected } }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      VStack(alignment: .leading, spacing: 4) {
        Text("Welcome to Messhall").font(.title2.bold())
        Text("Start a room with helper agents, or bring in the ones you already run.")
          .foregroundStyle(.secondary)
      }
      VStack(spacing: 8) {
        ForEach(RoomTemplate.templates) { card($0) }
      }
      folderRow
      if let template {
        Text(summary(template)).font(.callout).foregroundStyle(.secondary)
      }
      if let refusal {
        Text(refusal).foregroundStyle(.red)
      }
      HStack {
        Button("Skip") { finish() }
        Spacer()
        Button("Start", action: { start(template) })
          .keyboardShortcut(.defaultAction)
          .disabled(template == nil || folder == nil || starting)
      }
      Divider()
      bringIn
    }
    .padding(24)
    .frame(width: 480)
    .disabled(starting)
    .fileImporter(isPresented: $choosingFolder, allowedContentTypes: [.folder]) { result in
      if case .success(let url) = result { folder = url }
    }
  }

  private func card(_ template: RoomTemplate) -> some View {
    let isSelected = template.id == selected
    return Button { selected = template.id } label: {
      HStack(alignment: .top, spacing: 10) {
        Image(systemName: isSelected ? "largecircle.fill.circle" : "circle")
          .foregroundStyle(isSelected ? Color.accentColor : .secondary)
        VStack(alignment: .leading, spacing: 2) {
          Text(template.title).font(.headline)
          Text(template.blurb).font(.callout).foregroundStyle(.secondary)
          Text(template.bots.map(\.name).joined(separator: ", ")).font(.caption).foregroundStyle(.tertiary)
        }
        Spacer(minLength: 0)
      }
      .padding(10)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(
        RoundedRectangle(cornerRadius: 8).strokeBorder(isSelected ? Color.accentColor : Color.secondary.opacity(0.3)))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  private var folderRow: some View {
    HStack {
      Text("Agents start in").foregroundStyle(.secondary)
      Text(folder?.path(percentEncoded: false) ?? "Pick a project folder")
        .foregroundStyle(folder == nil ? .tertiary : .primary)
        .lineLimit(1)
        .truncationMode(.middle)
      Spacer()
      Button("Choose\u{2026}") { choosingFolder = true }
    }
    .help("Agents trust the folder they start in, so pick one project, not your home folder.")
  }

  private var bringIn: some View {
    VStack(alignment: .leading, spacing: 6) {
      Button("Bring in my running agents") { start(RoomTemplate.bringInRunning) }
        .disabled(folder == nil || starting)
      Text(
        "One helper lists your Claude sessions and shows a plan first. Agents that already report to another tool may get confused about where to post."
      )
      .font(.caption)
      .foregroundStyle(.secondary)
    }
  }

  private func summary(_ template: RoomTemplate) -> String {
    let name = template.roomName(taken: store.rooms.map(\.name))
    let count = template.bots.count
    return "Makes #\(startedRoom ?? name) and starts \(count) Claude agent\(count == 1 ? "" : "s") that trust the folder you pick."
  }

  private func start(_ template: RoomTemplate?) {
    guard let template, let folder else { return }
    starting = true
    refusal = nil
    Task {
      let started = await store.start(
        template, in: folder.path(percentEncoded: false), room: startedRoom, via: client)
      startedRoom = started.room
      refusal = started.refusal
      starting = false
      guard refusal == nil else { return }
      navigation.room = started.room
      finish()
    }
  }

  private func finish() {
    AppSettings.shared.snapshot.welcomed = true
    dismiss()
  }
}
