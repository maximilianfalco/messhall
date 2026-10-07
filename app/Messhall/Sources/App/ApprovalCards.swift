import Feed
import SwiftUI

/// The tool asks in this room still waiting on the human, one card each, oldest first.
struct ApprovalCards: View {
  let approvals: [Approval]
  let answer: (Approval, Bool) -> Void

  var body: some View {
    VStack(spacing: 8) {
      ForEach(approvals) { approval in
        ApprovalCard(approval: approval, answer: answer)
      }
    }
    .padding(.horizontal, 16)
    .padding(.bottom, 10)
  }
}

/// One ask: who asks, the tool, the agent's own summary and the call itself, with Deny and Allow.
/// The summary and the call are the agent's text, so the call shows as plain monospaced text.
/// Allow runs the whole call, so it is never cut: a long one scrolls in its box.
struct ApprovalCard: View {
  let approval: Approval
  let answer: (Approval, Bool) -> Void

  private static let previewHeight: CGFloat = 160

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      AvatarView(name: approval.member, size: 26)
      VStack(alignment: .leading, spacing: 4) {
        Text("\(approval.member) asks to use \(approval.tool)")
          .font(.callout.weight(.medium))
        Text(approval.description)
          .font(.callout)
          .foregroundStyle(.secondary)
          .lineLimit(2)
        ScrollView {
          Text(approval.inputPreview)
            .font(.caption.monospaced())
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxHeight: Self.previewHeight)
        .fixedSize(horizontal: false, vertical: true)
        .padding(6)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 6))
      }
      HStack(spacing: 8) {
        Button("Deny") { answer(approval, false) }
        Button("Allow") { answer(approval, true) }
          .buttonStyle(.borderedProminent)
      }
    }
    .padding(10)
    .background(.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.orange.opacity(0.35), lineWidth: 0.5))
    .accessibilityElement(children: .contain)
    .accessibilityLabel("\(approval.member) asks to use \(approval.tool): \(approval.description)")
  }
}

/// Says the member's agent waits on the human to allow a tool call.
struct AskPill: View {
  var body: some View {
    Label("asks", systemImage: "hand.raised.fill")
      .labelStyle(.titleAndIcon)
      .font(.subheadline)
      .fixedSize()
      .foregroundStyle(.orange)
      .padding(.horizontal, 6)
      .padding(.vertical, 1)
      .background(.orange.opacity(0.12), in: Capsule())
  }
}
