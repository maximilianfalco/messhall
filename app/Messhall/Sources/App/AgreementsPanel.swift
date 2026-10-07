import Feed
import SwiftUI

/// The room's open and settled agreements, oldest first, with who confirmed each one.
struct AgreementsPanel: View {
  let agreements: [Agreement]
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Label("Agreements: \(summary)", systemImage: "checkmark.seal")
        .font(.callout.weight(.medium))
      ForEach(agreements) { AgreementRow(agreement: $0) }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 16)
    .padding(.bottom, 10)
  }

  private var summary: String {
    let settled = agreements.filter { $0.state == .settled }.count
    let open = agreements.count - settled
    return [settled > 0 ? "\(settled) settled" : nil, open > 0 ? "\(open) open" : nil]
      .compactMap { $0 }
      .joined(separator: ", ")
  }
}

/// One agreement: its state, the agent's own text, who proposed it and a mark per named agent.
struct AgreementRow: View {
  let agreement: Agreement

  private var settled: Bool { agreement.state == .settled }

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Image(systemName: settled ? "checkmark.seal.fill" : "hourglass")
        .foregroundStyle(settled ? .green : .orange)
        .frame(width: 18)
        .help(settled ? "Settled" : "Open")
      VStack(alignment: .leading, spacing: 4) {
        Text(agreement.text)
          .font(.callout)
          .textSelection(.enabled)
        HStack(spacing: 8) {
          Text("#\(agreement.id) from \(agreement.proposer)")
            .foregroundStyle(.secondary)
          ForEach(agreement.with, id: \.self) { name in
            let yes = agreement.confirmed.contains(name)
            Label(name, systemImage: yes ? "checkmark.circle.fill" : "circle.dashed")
              .foregroundStyle(yes ? .green : .secondary)
              .help(yes ? "\(name) confirmed" : "waiting on \(name)")
          }
        }
        .font(.caption)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .accessibilityElement(children: .combine)
    .accessibilityLabel(accessibilityText)
  }

  private var accessibilityText: String {
    let waiting = agreement.waitingOn
    let state = settled ? "settled" : "open, waiting on \(waiting.joined(separator: ", "))"
    return "Agreement from \(agreement.proposer), \(state): \(agreement.text)"
  }
}
