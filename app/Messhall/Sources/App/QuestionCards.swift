import Feed
import SwiftUI

/// The questions in this room still waiting on the human, one card each, oldest first.
struct QuestionCards: View {
  let questions: [Question]
  let answer: (Question, Int) -> Void

  var body: some View {
    VStack(spacing: 8) {
      ForEach(questions) { question in
        QuestionCard(question: question, answer: answer)
      }
    }
    .padding(.horizontal, 16)
    .padding(.bottom, 10)
  }
}

/// One question: who asks, the agent's own text, and one equal button per option so no pick is nudged.
struct QuestionCard: View {
  let question: Question
  let answer: (Question, Int) -> Void

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      AvatarView(name: question.member, size: 26)
      VStack(alignment: .leading, spacing: 6) {
        Text("\(question.member) asks you")
          .font(.callout.weight(.medium))
        Text(question.question)
          .font(.callout)
          .textSelection(.enabled)
          .fixedSize(horizontal: false, vertical: true)
        ViewThatFits(in: .horizontal) {
          HStack(spacing: 8) { options }
          VStack(alignment: .leading, spacing: 6) { options }
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(10)
    .background(.blue.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.blue.opacity(0.35), lineWidth: 0.5))
    .accessibilityElement(children: .contain)
    .accessibilityLabel("\(question.member) asks you: \(question.question)")
  }

  private var options: some View {
    ForEach(Array(question.options.enumerated()), id: \.offset) { index, option in
      Button(option) { answer(question, index) }
        .buttonStyle(.bordered)
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
