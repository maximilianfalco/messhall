import AppKit
import Feed
import SwiftUI

/// How long a copy button says Copied.
let copiedFor = Duration.seconds(1.5)

func copyToPasteboard(_ text: String) {
  NSPasteboard.general.clearContents()
  NSPasteboard.general.setString(text, forType: .string)
}

/// Copies the join prompt in one click. Its menu also copies the launch command.
struct CopyJoinButton: View {
  let room: String
  @State private var copied = false

  var body: some View {
    Menu {
      Button("Copy Join Prompt") { copy(JoinPrompt.prompt(room: room)) }
      Button("Copy Launch Command") { copy(JoinPrompt.launchCommand(room: room)) }
    } label: {
      Label(JoinPrompt.buttonLabel(copied: copied), systemImage: copied ? "checkmark" : "doc.on.doc")
        .contentTransition(.symbolEffect(.replace))
    } primaryAction: {
      copy(JoinPrompt.prompt(room: room))
    }
    .help(copied ? "Copied" : "Copy a line that tells any agent to join #\(room)")
    .accessibilityLabel(JoinPrompt.buttonLabel(copied: copied))
  }

  private func copy(_ text: String) {
    copyToPasteboard(text)
    copied = true
    Task {
      try? await Task.sleep(for: copiedFor)
      copied = false
    }
  }
}

/// The empty transcript. With no agent in the room it shows how to bring one in.
struct EmptyTranscript: View {
  let room: String
  let copy: EmptyRoomCopy

  var body: some View {
    switch copy {
    case .waitForPosts:
      ContentUnavailableView(
        "No Messages Yet", systemImage: "text.bubble",
        description: Text("Posts show up here as the agents talk."))
    case .startAgent:
      ContentUnavailableView {
        Label("No Messages Yet", systemImage: "text.bubble")
      } description: {
        Text("Start an agent in this room:")
      } actions: {
        VStack(spacing: 10) {
          CopyLine(text: JoinPrompt.launchCommand(room: room), what: "launch command", monospaced: true)
          Text("or tell any agent with messhall installed to join #\(room)")
            .font(.callout)
            .foregroundStyle(.secondary)
          CopyLine(text: JoinPrompt.prompt(room: room), what: "join prompt", monospaced: false)
        }
        .frame(maxWidth: 520)
      }
    }
  }
}

/// A line of text to paste somewhere else, with its own Copy button.
struct CopyLine: View {
  let text: String
  let what: String
  let monospaced: Bool
  @State private var copied = false

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 10) {
      Text(text)
        .font(monospaced ? .body.monospaced() : .callout)
        .multilineTextAlignment(.leading)
        .textSelection(.enabled)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
      Button(copied ? "Copied" : "Copy") {
        copyToPasteboard(text)
        copied = true
        Task {
          try? await Task.sleep(for: copiedFor)
          copied = false
        }
      }
      .controlSize(.small)
      .fixedSize()
      .accessibilityLabel(copied ? "Copied" : "Copy \(what)")
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
    .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
  }
}
