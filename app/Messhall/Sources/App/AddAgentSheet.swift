import Feed
import SwiftUI

struct AddAgentSheet: View {
  let room: String
  let taken: [String]
  let add: (HumanSpawn) -> Void
  @State private var draft: AddAgentDraft
  @State private var choosingFolder = false
  @Environment(\.dismiss) private var dismiss

  init(room: String, taken: [String], draft: AddAgentDraft = AddAgentDraft(), add: @escaping (HumanSpawn) -> Void) {
    self.room = room
    self.taken = taken
    self.add = add
    _draft = State(initialValue: draft)
  }

  private var problem: String? { draft.problem(taken: taken) }
  private var seat: HumanSpawn? { draft.seat(taken: taken) }

  var body: some View {
    VStack(spacing: 0) {
      Text("Add Agent to #\(room)")
        .font(.headline)
        .padding(.top, 20)
      form
    }
    .frame(width: 440)
    .fileImporter(isPresented: $choosingFolder, allowedContentTypes: [.folder]) { result in
      if case .success(let url) = result { draft.folder = url.path(percentEncoded: false) }
    }
    .toolbar {
      ToolbarItem(placement: .cancellationAction) {
        Button("Cancel") { dismiss() }
      }
      ToolbarItem(placement: .confirmationAction) {
        Button("Add Agent", action: submit)
          .keyboardShortcut(.defaultAction)
          .disabled(seat == nil)
      }
    }
  }

  private var form: some View {
    Form {
      Section {
        TextField("Name", text: $draft.name, prompt: Text("web"))
        Picker("Role", selection: $draft.role) {
          ForEach(AddAgentDraft.roles, id: \.self) { Text($0.capitalized).tag($0) }
        }
        Picker("Agent", selection: $draft.agent) {
          ForEach(SpawnAgent.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
        }
        .pickerStyle(.segmented)
      } footer: {
        Text(problem ?? "Lowercase letters, numbers and dashes, up to \(RoomName.maxLength).")
          .foregroundStyle(problem == nil ? Color.secondary : Color.red)
      }
      Section("Instructions") {
        TextEditor(text: $draft.instructions)
          .font(.body)
          .frame(height: 90)
          .accessibilityLabel("Instructions")
      }
      Section {
        LabeledContent("Starts in") {
          HStack {
            Text(draft.folder ?? "Pick a project folder")
              .foregroundStyle(draft.folder == nil ? .tertiary : .primary)
              .lineLimit(1)
              .truncationMode(.middle)
            Button("Choose\u{2026}") { choosingFolder = true }
          }
        }
      } footer: {
        Text("The agent trusts the folder it starts in, so pick one project, not your home folder.")
          .foregroundStyle(.secondary)
      }
    }
    .formStyle(.grouped)
    .scrollDisabled(true)
  }

  // The spawn waits for the agent to sit down, so the sheet goes now and the chip says starting.
  private func submit() {
    guard let seat else { return }
    add(seat)
    dismiss()
  }
}

/// Says the seat waits for its agent: starting while the app's own spawn runs, invited for anyone else's.
struct LaunchPillView: View {
  let pill: LaunchPill

  var body: some View {
    Label(pill.rawValue, systemImage: pill == .starting ? "hourglass" : "envelope")
      .labelStyle(.titleAndIcon)
      .font(.subheadline)
      .fixedSize()
      .foregroundStyle(.blue)
      .padding(.horizontal, 6)
      .padding(.vertical, 1)
      .background(.blue.opacity(0.12), in: Capsule())
  }
}
