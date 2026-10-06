import Feed
import SwiftUI

struct RoomDetail: View {
  let room: SnapshotRoom
  let store: FeedStore
  let client: FeedClient

  private var subtitle: String {
    let posts = "\(room.messageCount) of \(room.messageCap) posts"
    guard let topic = room.topic else { return room.isOpen ? posts : "Closed, \(posts)" }
    return "\(topic), \(posts)"
  }

  var body: some View {
    VStack(spacing: 0) {
      if case .down = store.phase { ReconnectBanner() }
      MemberStrip(members: room.members)
      Divider()
      Transcript(messages: room.messages)
      Divider()
      PostBox(room: room, store: store, client: client)
    }
    .navigationTitle("#\(room.name)")
    .navigationSubtitle(subtitle)
    .toolbar { MuteButton(room: room.name) }
  }
}

struct ReconnectBanner: View {
  var body: some View {
    Label("Lost the daemon. Reconnecting. Run messhall start if it stays down.", systemImage: "exclamationmark.triangle")
      .font(.callout)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 16)
      .padding(.vertical, 8)
      .background(.orange.opacity(0.15))
  }
}

struct MemberStrip: View {
  let members: [Member]

  private var ordered: [Member] {
    members.filter { $0.kind != .human } + members.filter { $0.kind == .human }
  }

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 8) {
        ForEach(ordered, id: \.name) { MemberChip(member: $0) }
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 10)
    }
  }
}

struct MemberChip: View {
  let member: Member

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: member.kind.symbol)
        .foregroundStyle(.secondary)
        .frame(width: 16)
      VStack(alignment: .leading, spacing: 1) {
        Text(member.displayName)
          .font(.callout.weight(.medium))
        HStack(spacing: 4) {
          PresenceDot(presence: member.presence)
          Text(member.presence.label)
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      }
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 6)
    .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
    .opacity(member.presence == .gone ? 0.6 : 1)
    .help("\(member.displayName) runs on \(member.kind.rawValue) and is \(member.presence.rawValue)")
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(member.displayName), \(member.kind.rawValue), \(member.presence.rawValue)")
  }
}

struct PresenceDot: View {
  let presence: Presence

  var body: some View {
    Group {
      if presence == .gone {
        Circle().strokeBorder(presence.color, lineWidth: 1.5)
      } else {
        Circle().fill(presence.color)
      }
    }
    .frame(width: 7, height: 7)
  }
}

struct Transcript: View {
  let messages: [Message]

  var body: some View {
    if messages.isEmpty {
      ContentUnavailableView(
        "No Messages Yet", systemImage: "text.bubble",
        description: Text("Posts show up here as the agents talk."))
    } else {
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 6) {
            ForEach(messages) { MessageRow(message: $0).id($0.id) }
          }
          .padding(16)
        }
        .defaultScrollAnchor(.bottom)
        .onChange(of: messages.last?.id) { _, last in
          withAnimation { proxy.scrollTo(last, anchor: .bottom) }
        }
      }
    }
  }
}

struct MessageRow: View {
  let message: Message

  var body: some View {
    switch message.kind {
    case .system:
      Text("\(message.text)  \(message.time)")
        .font(.caption)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 2)
    case .done:
      Label {
        Text("**\(message.from)** is done: \(message.text)")
      } icon: {
        Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
      }
      .foregroundStyle(.secondary)
      .padding(.vertical, 2)
    case .chat:
      ChatRow(message: message)
    }
  }
}

struct ChatRow: View {
  let message: Message

  private var isHuman: Bool { message.from == humanName }

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      HStack(spacing: 6) {
        if isHuman { Image(systemName: MemberKind.human.symbol) }
        Text(isHuman ? youLabel : message.from).fontWeight(.semibold)
        Text(message.time)
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      .foregroundStyle(isHuman ? Color.accentColor : .primary)
      Text(message.text)
        .textSelection(.enabled)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 8)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(isHuman ? Color.accentColor.opacity(0.1) : .clear, in: RoundedRectangle(cornerRadius: 8))
  }
}

struct PostBox: View {
  let room: SnapshotRoom
  let store: FeedStore
  let client: FeedClient
  @State private var text = ""
  @State private var sending = false
  @State private var refusal: String?

  private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .bottom, spacing: 8) {
        TextField(
          room.isOpen ? "Message #\(room.name) as human" : "Message #\(room.name) to reopen it",
          text: $text, axis: .vertical
        )
        .textFieldStyle(.plain)
        .lineLimit(1...6)
        .onSubmit(send)
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(.background, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(.separator))
        Button(action: send) {
          Image(systemName: "arrow.up.circle.fill")
            .font(.title)
        }
        .buttonStyle(.borderless)
        .disabled(trimmed.isEmpty || sending)
        .accessibilityLabel("Send")
        .help("Send as human")
      }
      if let refusal {
        Text(refusal)
          .font(.caption)
          .foregroundStyle(.red)
      }
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
  }

  private func send() {
    guard !trimmed.isEmpty, !sending else { return }
    let draft = trimmed
    sending = true
    Task {
      refusal = await store.post(draft, room: room.name, via: client)
      if refusal == nil { text = "" }
      sending = false
    }
  }
}
