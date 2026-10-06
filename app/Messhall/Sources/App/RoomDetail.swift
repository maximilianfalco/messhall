import Feed
import SwiftUI

struct RoomDetail: View {
  let room: SnapshotRoom
  let store: FeedStore
  let client: FeedClient
  let columnsChangedAt: Date?
  @State private var confirmingClose = false
  @State private var refusal: String?
  @State private var query = ""
  @State private var draft = Self.startDraft
  @FocusState private var composing: Bool

  #if DEBUG
    private static let startDraft = ShotHooks.draft ?? ""
  #else
    private static let startDraft = ""
  #endif

  private var subtitle: String {
    let posts = "\(room.messageCount) of \(room.messageCap) posts"
    guard let topic = room.topic else { return room.isOpen ? posts : "Closed, \(posts)" }
    return "\(topic), \(posts)"
  }

  var body: some View {
    VStack(spacing: 0) {
      if case .down = store.phase { ReconnectBanner() }
      RoomHeader(room: room, subtitle: subtitle)
      MemberStrip(members: room.present, mention: room.isOpen ? { mention($0) } : nil)
      Divider()
      Transcript(
        room: room.name, messages: room.messages.matching(query), members: room.members, query: query,
        columnsChangedAt: columnsChangedAt)
        .id(room.name)
      Divider()
      if room.isOpen {
        PostBox(room: room, store: store, client: client, text: $draft, focused: $composing)
      } else {
        ClosedBar(reopen: { change(.reopen(room.name)) })
      }
    }
    .navigationTitle("#\(room.name)")
    .titleInHeader()
    .searchable(text: $query, placement: .toolbar, prompt: "Filter #\(room.name)")
    .onChange(of: room.name) { query = "" }
    .toolbar {
      if #available(macOS 26, *) { ToolbarSpacer(.flexible) }
      ToolbarItem { CopyJoinButton(room: room.name) }
      ToolbarItem { MuteButton(room: room.name) }
      ToolbarItem {
        if room.isOpen {
          Button("Close Room", systemImage: "lock", action: toggle)
            .help("Close #\(room.name)")
        } else {
          Button("Reopen Room", systemImage: "lock.open", action: toggle)
            .help("Reopen #\(room.name)")
        }
      }
    }
    .focusedSceneValue(\.roomToggle, RoomToggle(isOpen: room.isOpen, run: toggle))
    .confirmationDialog("Close #\(room.name)?", isPresented: $confirmingClose) {
      Button("Close Room") { change(.close(room.name)) }
    } message: {
      Text("Agents can no longer post. You can still read it and reopen it later.")
    }
    .alert(
      "Could Not Change #\(room.name)", isPresented: Binding(get: { refusal != nil }, set: { if !$0 { refusal = nil } })
    ) {
      Button("OK") {}
    } message: {
      Text(refusal ?? "")
    }
  }

  private func mention(_ name: String) {
    draft = appendMention(name, to: draft)
    composing = true
  }

  private func toggle() {
    if room.isOpen { confirmingClose = true } else { change(.reopen(room.name)) }
  }

  private func change(_ action: RoomAction) {
    Task { refusal = await store.change(action, via: client) }
  }
}

/// The open room's Close or Reopen action, so the menu bar can offer it too.
struct RoomToggle {
  let isOpen: Bool
  let run: () -> Void
}

extension FocusedValues {
  @Entry var roomToggle: RoomToggle?
}

struct RoomToggleCommand: View {
  @FocusedValue(\.roomToggle) private var toggle

  var body: some View {
    Button(toggle?.isOpen == false ? "Reopen Room" : "Close Room\u{2026}") { toggle?.run() }
      .disabled(toggle == nil)
  }
}

extension View {
  /// The room's name and post count live in the header, so the toolbar drops its copy.
  /// Only where a flexible spacer can keep the buttons on the right.
  @ViewBuilder func titleInHeader() -> some View {
    if #available(macOS 26, *) { toolbar(removing: .title) } else { self }
  }
}

/// The room's name and post count, then the Standing badge and who made it.
struct RoomHeader: View {
  let room: SnapshotRoom
  let subtitle: String

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text("#\(room.name)")
          .font(.title3.weight(.semibold))
          .lineLimit(1)
        Text(subtitle)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
      .accessibilityElement(children: .combine)
      .accessibilityAddTraits(.isHeader)
      RoomOrigin(room: room)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 16)
    .padding(.top, 10)
  }
}

struct RoomOrigin: View {
  let room: SnapshotRoom

  private var maker: String { room.createdBy == humanName ? "Made by human" : "Made by \(room.createdBy)" }

  var body: some View {
    HStack(spacing: 8) {
      if room.standing {
        Label("Standing", systemImage: "pin.fill")
          .font(.caption.weight(.semibold))
          .foregroundStyle(Color.accentColor)
          .padding(.horizontal, 8)
          .padding(.vertical, 3)
          .background(Color.accentColor.opacity(0.12), in: Capsule())
          .help("Stays open when agents finish. Only you close it, or the post cap.")
      }
      Text(maker)
        .font(.callout)
        .foregroundStyle(.secondary)
      Spacer()
    }
    .accessibilityElement(children: .combine)
  }
}

struct ClosedBar: View {
  let reopen: () -> Void

  var body: some View {
    HStack(spacing: 8) {
      Label("Room is closed. Reopen to post.", systemImage: "lock")
        .foregroundStyle(.secondary)
      Spacer()
      Button("Reopen", action: reopen)
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
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
  let mention: ((String) -> Void)?

  private var ordered: [Member] {
    members.filter { $0.kind != .human } + members.filter { $0.kind == .human }
  }

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 8) {
        ForEach(ordered, id: \.name) { member in
          if let mention, member.kind != .human {
            Button { mention(member.name) } label: { MemberChip(member: member) }
              .buttonStyle(.plain)
              .accessibilityHint("Mentions \(member.name) in your message")
          } else {
            MemberChip(member: member)
          }
        }
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
      AvatarView(name: member.name, size: 26)
      VStack(alignment: .leading, spacing: 1) {
        HStack(spacing: 5) {
          Text(member.displayName)
            .font(.callout.weight(.medium))
          if let label = member.clientLabel {
            TypePill(label: label, name: member.name)
          }
        }
        HStack(spacing: 4) {
          PresenceDot(presence: member.presence)
          Text(member.presence.label)
          if member.kind != .human, member.clientLabel == nil {
            Image(systemName: member.kind.symbol)
              .imageScale(.small)
          }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
      }
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 6)
    .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
    .opacity(member.presence.isAway ? 0.6 : 1)
    .help(member.help(as: member.displayName))
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(member.spokenLabel(as: member.displayName))
  }
}

/// The agent type next to a name, tinted with the member's avatar hue.
struct TypePill: View {
  let label: String
  let name: String

  var body: some View {
    Text(label)
      .font(.subheadline.weight(.medium))
      .lineLimit(1)
      .foregroundStyle(.primary)
      .padding(.horizontal, 6)
      .padding(.vertical, 1)
      .background(avatarColor(for: name).opacity(0.18), in: Capsule())
      .overlay(Capsule().strokeBorder(avatarColor(for: name).opacity(0.35), lineWidth: 0.5))
  }
}

struct PresenceDot: View {
  let presence: Presence

  var body: some View {
    Group {
      if presence.isAway {
        Circle().strokeBorder(presence.color, lineWidth: 1.5)
      } else {
        Circle().fill(presence.color)
      }
    }
    .frame(width: 7, height: 7)
  }
}

struct Transcript: View {
  let room: String
  let messages: [Message]
  let members: [Member]
  let query: String
  let columnsChangedAt: Date?
  @State private var nearBottom = true
  @State private var showPill = false
  @State private var opened: [Int: Bool] = [:]

  private static let end = "end"

  // A filter shows the matching lines as they are, so a search for a name is not hidden in a fold.
  private var items: [TranscriptItem] {
    query.trimmingCharacters(in: .whitespaces).isEmpty ? messages.folded() : messages.map { .message($0) }
  }

  var body: some View {
    if messages.isEmpty, !query.trimmingCharacters(in: .whitespaces).isEmpty {
      ContentUnavailableView.search(text: query)
        .frame(maxHeight: .infinity)
    } else if messages.isEmpty {
      EmptyTranscript(room: room, copy: .pick(members: members))
        .frame(maxHeight: .infinity)
    } else {
      ScrollViewReader { proxy in
        ScrollView {
          VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
              ForEach(items) { item in
                switch item {
                case .message(let message):
                  MessageRow(message: message, sender: members.first { $0.name == message.from }).id(item.id)
                case .fold(let fold):
                  let open = isOpen(fold)
                  FoldRow(fold: fold, open: open) { toggle(fold, to: !open, proxy) }.id(item.id)
                }
              }
            }
            .padding(16)
            Color.clear.frame(height: 1).id(Self.end)
          }
          // A Bool, so a column slide that keeps the view at the bottom writes no state each frame.
          .onGeometryChange(for: Bool.self) { geometry in
            let visible = geometry.bounds(of: .scrollView) ?? .zero
            return Follow.isNearBottom(
              contentBottom: geometry.size.height - visible.minY, viewportHeight: visible.height)
          } action: { atBottom in
            nearBottom = atBottom
            if atBottom { showPill = false }
          }
        }
        .defaultScrollAnchor(.bottom)
        .overlay(alignment: .bottom) {
          if showPill {
            JumpToLatest { scroll(proxy, animated: true) }
              .padding(.bottom, 12)
              .transition(.move(edge: .bottom).combined(with: .opacity))
          }
        }
        .onAppear { start(proxy) }
        .onChange(of: messages.last?.id) { before, after in
          let fromHuman = messages.last?.from == humanName
          let wait = Follow.wait(columnsChangedAt: columnsChangedAt, now: .now)
          // The next turn, so the new row has its size before the scroll aims at the end.
          DispatchQueue.main.asyncAfter(deadline: .now() + wait) {
            switch Follow.action(lastBefore: before, lastAfter: after, fromHuman: fromHuman, nearBottom: nearBottom) {
            case .scroll(let animated): scroll(proxy, animated: animated)
            case .showPill: withAnimation(.easeOut) { showPill = true }
            case .none: break
            }
          }
        }
      }
    }
  }

  private func start(_ proxy: ScrollViewProxy) {
    scroll(proxy, animated: false)
    #if DEBUG
      // The bottom anchor wins the first layout, so the shot scrolls up a beat later.
      if ShotHooks.startAtTop {
        Task {
          try? await Task.sleep(for: .milliseconds(500))
          proxy.scrollTo(messages.first?.id, anchor: .top)
        }
      }
    #endif
  }

  private func isOpen(_ fold: Fold) -> Bool {
    #if DEBUG
      if ShotHooks.openFolds, opened[fold.id] == nil { return true }
    #endif
    return opened[fold.id] ?? fold.startsOpen
  }

  private func toggle(_ fold: Fold, to open: Bool, _ proxy: ScrollViewProxy) {
    let action = Follow.afterToggle(nearBottom: nearBottom)
    opened[fold.id] = open
    // The next turn, so the run has its new height before the scroll aims at the end.
    DispatchQueue.main.async {
      if case .scroll(let animated) = action { scroll(proxy, animated: animated) }
    }
  }

  private func scroll(_ proxy: ScrollViewProxy, animated: Bool) {
    showPill = false
    guard animated else {
      proxy.scrollTo(Self.end, anchor: .bottom)
      return
    }
    withAnimation(.easeOut) { proxy.scrollTo(Self.end, anchor: .bottom) }
  }
}

struct JumpToLatest: View {
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Label("Jump to Latest", systemImage: "arrow.down")
        .font(.callout.weight(.medium))
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }
    .buttonStyle(.plain)
    .background(.regularMaterial, in: Capsule())
    .overlay(Capsule().strokeBorder(.separator))
    .shadow(color: .black.opacity(0.12), radius: 6, y: 2)
    .help("Scroll to the newest message")
  }
}

struct FoldRow: View {
  let fold: Fold
  let open: Bool
  let toggle: () -> Void
  @State private var hovering = false

  private var span: String {
    let (first, last) = (fold.messages[0].time, fold.messages[fold.messages.count - 1].time)
    return first == last ? first : "\(first) to \(last)"
  }

  var body: some View {
    VStack(spacing: 6) {
      Button(action: toggle) {
        HStack(spacing: 6) {
          Image(systemName: "chevron.right")
            .imageScale(.small)
            .fontWeight(.semibold)
            .rotationEffect(.degrees(open ? 90 : 0))
          Text("\(fold.messages.count) presence changes  \(span)")
        }
        .font(.caption)
        .foregroundStyle(hovering ? .primary : .secondary)
        .padding(.horizontal, 8)
        .padding(.vertical, 2)
        .background(.quaternary.opacity(hovering ? 0.6 : 0), in: Capsule())
        .contentShape(Capsule())
      }
      .buttonStyle(.plain)
      .onHover { hovering = $0 }
      .help(open ? "Hide these lines" : "Show these lines")
      .accessibilityLabel("\(fold.messages.count) presence changes, \(span)")
      .accessibilityValue(open ? "Expanded" : "Collapsed")
      if open {
        ForEach(fold.messages) { MessageRow(message: $0, sender: nil) }
      }
    }
    .frame(maxWidth: .infinity)
  }
}

struct MessageRow: View {
  let message: Message
  let sender: Member?

  var body: some View {
    switch message.kind {
    case .system:
      Text("\(message.text)  \(message.time)")
        .font(.caption)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 2)
    case .done:
      HStack(spacing: 10) {
        Image(systemName: "checkmark.circle.fill")
          .foregroundStyle(.green)
          .frame(width: 28)
        Text("**\(message.from)** is done: \(message.text)")
      }
      .foregroundStyle(.secondary)
      .padding(.horizontal, 10)
      .padding(.vertical, 2)
    case .summary:
      Label {
        VStack(alignment: .leading, spacing: 3) {
          Text("Summary so far  \(message.time)").font(.caption).foregroundStyle(.secondary)
          Text(message.text)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
        }
      } icon: {
        Image(systemName: "text.quote").foregroundStyle(.secondary)
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 8)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
    case .chat:
      ChatRow(message: message, sender: sender)
    }
  }
}

struct ChatRow: View {
  let message: Message
  let sender: Member?

  var body: some View {
    let line = message.chatLine(sender: sender)
    HStack(alignment: .top, spacing: 10) {
      if !line.mine { AvatarView(name: message.from) }
      VStack(alignment: line.mine ? .trailing : .leading, spacing: 3) {
        HStack(spacing: 6) {
          Text(line.title).fontWeight(.semibold)
          if let label = line.pill {
            TypePill(label: label, name: message.from)
              .help(sender?.client ?? label)
          }
          Text(message.time)
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .foregroundStyle(line.mine ? Color.accentColor : .primary)
        Text(mentionText(message))
          .multilineTextAlignment(line.mine ? .trailing : .leading)
          .textSelection(.enabled)
          .fixedSize(horizontal: false, vertical: true)
      }
      if line.mine { AvatarView(name: message.from) }
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 8)
    .background(line.mine ? Color.accentColor.opacity(0.1) : .clear, in: RoundedRectangle(cornerRadius: 8))
    .padding(line.mine ? .leading : .trailing, line.mine ? 48 : 0)
    .frame(maxWidth: .infinity, alignment: line.mine ? .trailing : .leading)
  }
}

struct PostBox: View {
  let room: SnapshotRoom
  let store: FeedStore
  let client: FeedClient
  @Binding var text: String
  var focused: FocusState<Bool>.Binding
  @State private var sending = false
  @State private var refusal: String?
  @State private var highlight: String?
  @State private var dismissedOn: String?

  private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

  private var candidates: [String] {
    guard text != dismissedOn, let query = mentionQuery(in: text) else { return [] }
    return Array(mentionCandidates(query: query, members: room.members).prefix(6))
  }

  private var selected: String? { pickedMention(highlight, in: candidates) }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .bottom, spacing: 8) {
        TextField("Message #\(room.name) as human", text: $text, axis: .vertical)
        .textFieldStyle(.plain)
        .lineLimit(1...6)
        .focused(focused)
        .onSubmit(submit)
        .onKeyPress(.downArrow) { move(by: 1) }
        .onKeyPress(.upArrow) { move(by: -1) }
        .onKeyPress(.tab) { complete() }
        .onKeyPress(.escape) {
          guard !candidates.isEmpty else { return .ignored }
          dismissedOn = text
          return .handled
        }
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
    .overlay(alignment: .topLeading) {
      if !candidates.isEmpty {
        MentionPicker(names: candidates, selected: selected, members: room.members, pick: pick)
          .padding(.leading, 16)
          .padding(.bottom, 4)
          .frame(height: 0, alignment: .bottomLeading)
      }
    }
  }

  // Return picks the name while the list is up, so a half typed mention is never sent.
  private func submit() {
    if complete() == .ignored { send() }
  }

  @discardableResult private func complete() -> KeyPress.Result {
    guard let selected else { return .ignored }
    pick(selected)
    return .handled
  }

  private func move(by step: Int) -> KeyPress.Result {
    guard let selected, let next = steppedMention(from: selected, by: step, in: candidates) else { return .ignored }
    highlight = next
    return .handled
  }

  private func pick(_ name: String) {
    text = completeMention(name, in: text)
    highlight = nil
    focused.wrappedValue = true
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
