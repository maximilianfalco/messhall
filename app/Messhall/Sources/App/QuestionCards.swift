import Feed
import SwiftUI

/// How the human answers an agent's question from its asking line. Returns the refusal text, or nil.
struct AnswerQuestion {
  let run: (Question, [QuestionAnswer]) async -> String?
}

extension EnvironmentValues {
  @Entry var answerQuestion: AnswerQuestion?
}

/// An agent's ask under its own line: the open form while it waits, one line on how it ended after.
struct QuestionPanel: View {
  let question: Question

  var body: some View {
    if question.state == .open {
      QuestionForm(question: question)
        .id(question.id)
    } else {
      SettledQuestion(question: question)
    }
  }
}

/// Every question with its header chip, its options as whole clickable rows with a check on the right,
/// an Other box for the human's own words, and one Submit for all of them.
struct QuestionForm: View {
  let question: Question
  @State private var draft: QuestionDraft
  @State private var sending = false
  @State private var refusal: String?
  @Environment(\.answerQuestion) private var answer

  init(question: Question) {
    self.question = question
    var draft = QuestionDraft(items: question.items)
    #if DEBUG
      if let other = ShotHooks.other, let last = question.items.indices.last { draft.setOther(other, in: last) }
    #endif
    _draft = State(initialValue: draft)
  }

  var body: some View {
    #if DEBUG
      let _ = PerfHooks.formBodies += 1
    #endif
    VStack(alignment: .leading, spacing: 14) {
      ForEach(Array(question.items.enumerated()), id: \.offset) { index, item in
        itemView(item, at: index)
      }
      HStack(spacing: 10) {
        if let refusal {
          Text(refusal)
            .font(.caption)
            .foregroundStyle(.red)
        }
        Spacer()
        Button("Submit", action: submit)
          .buttonStyle(.borderedProminent)
          .disabled(draft.answers == nil || sending || answer == nil)
          .help(draft.answers == nil ? "Answer every question first" : "Send your answer to \(question.member)")
      }
    }
    .padding(12)
    .background(.blue.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.blue.opacity(0.3), lineWidth: 0.5))
    .frame(maxWidth: 520, alignment: .leading)
    #if DEBUG
      .onAppear { PerfHooks.pickInForm = { draft.toggle($0, in: $1) } }
    #endif
  }

  private func itemView(_ item: QuestionItem, at index: Int) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 6) {
        if let header = item.header { HeaderChip(text: header) }
        Text(item.multiSelect ? "Pick any" : "Pick one")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      Text(item.question)
        .font(.callout.weight(.medium))
        .textSelection(.enabled)
        .fixedSize(horizontal: false, vertical: true)
      VStack(spacing: 0) {
        ForEach(Array(item.options.enumerated()), id: \.offset) { option, choice in
          OptionRow(
            option: choice, multi: item.multiSelect, picked: draft.isPicked(option, in: index)
          ) { draft.toggle(option, in: index) }
          Divider()
        }
        OtherRow(
          text: Binding(get: { draft.other(in: index) }, set: { draft.setOther($0, in: index) }),
          multi: item.multiSelect, picked: draft.isOtherPicked(in: index))
      }
      .background(.background, in: RoundedRectangle(cornerRadius: 8))
      .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.separator, lineWidth: 0.5))
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("\(item.header.map { "\($0): " } ?? "")\(item.question)")
  }

  private func submit() {
    guard let answers = draft.answers, let answer, !sending else { return }
    sending = true
    Task {
      refusal = await answer.run(question, answers)
      sending = false
    }
  }
}

struct HeaderChip: View {
  let text: String

  var body: some View {
    Text(text)
      .font(.caption.weight(.semibold))
      .foregroundStyle(.blue)
      .padding(.horizontal, 7)
      .padding(.vertical, 2)
      .background(.blue.opacity(0.12), in: Capsule())
  }
}

private struct Check: View {
  let multi: Bool
  let picked: Bool

  var body: some View {
    Image(systemName: multi ? (picked ? "checkmark.square.fill" : "square") : (picked ? "checkmark.circle.fill" : "circle"))
      .foregroundStyle(picked ? Color.accentColor : .secondary)
      .imageScale(.large)
  }
}

private struct OptionRow: View {
  let option: QuestionOption
  let multi: Bool
  let picked: Bool
  let toggle: () -> Void

  var body: some View {
    Button(action: toggle) {
      HStack(alignment: .center, spacing: 10) {
        VStack(alignment: .leading, spacing: 2) {
          HStack(spacing: 6) {
            Text(option.label)
            if option.recommended {
              Text("Recommended")
                .font(.caption2.weight(.medium))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 5)
                .padding(.vertical, 1)
                .background(.quaternary, in: Capsule())
            }
          }
          if let description = option.description {
            Text(description)
              .font(.caption)
              .foregroundStyle(.secondary)
              .fixedSize(horizontal: false, vertical: true)
          }
        }
        Spacer(minLength: 8)
        Check(multi: multi, picked: picked)
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 7)
      .contentShape(Rectangle())
      .background(picked ? Color.accentColor.opacity(0.1) : .clear)
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(picked ? .isSelected : [])
  }
}

private struct OtherRow: View {
  @Binding var text: String
  let multi: Bool
  let picked: Bool

  var body: some View {
    HStack(spacing: 10) {
      TextField("Other: type your own answer", text: $text)
        .textFieldStyle(.plain)
      Check(multi: multi, picked: picked)
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 7)
    .background(picked ? Color.accentColor.opacity(0.1) : .clear)
  }
}

/// A question no longer waiting: what it asked, then one line with the pick, or why it closed.
struct SettledQuestion: View {
  let question: Question

  private var outcome: (text: String, icon: String) {
    switch question.state {
    case .answered: ("You picked: \(question.picked ?? "")", "checkmark.circle")
    case .expired: ("No answer in time, the agent went on", "clock")
    case .replaced: ("Replaced by a newer question", "arrow.uturn.right")
    case .open, .unknown: ("Closed", "xmark.circle")
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      ForEach(Array(question.items.enumerated()), id: \.offset) { _, item in
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          if let header = item.header { HeaderChip(text: header) }
          Text(item.question)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
      Label(outcome.text, systemImage: outcome.icon)
        .font(.callout)
        .foregroundStyle(.secondary)
    }
  }
}

/// Says how many questions in a room wait on the human.
struct QuestionBadge: View {
  let count: Int

  var body: some View {
    Label("\(count)", systemImage: "questionmark.bubble.fill")
      .labelStyle(.titleAndIcon)
      .font(.caption.weight(.medium))
      .foregroundStyle(.blue)
      .padding(.horizontal, 6)
      .padding(.vertical, 1)
      .background(.blue.opacity(0.12), in: Capsule())
      .fixedSize()
      .help(Self.summary(count))
  }

  static func summary(_ count: Int) -> String {
    count == 1 ? "1 question for you" : "\(count) questions for you"
  }
}
