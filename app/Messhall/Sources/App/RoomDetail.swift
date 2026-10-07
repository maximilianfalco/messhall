import AppKit
import Feed
import SwiftUI

struct RoomDetail: View {
  let room: SnapshotRoom
  let store: FeedStore
  let client: FeedClient
  let columnsChangedAt: Date?
  let reveal: Reveal?
  @State private var confirmingClose = false
  @State private var refusal: String?
  @State private var query = ""
  @State private var draft = Self.startDraft
  @FocusState private var composing: Bool
  @Environment(Notifier.self) private var notifier

  #if DEBUG
    private static let startDraft = ShotHooks.draft ?? ""
  #else
    private static let startDraft = ""
  #endif

  private var subtitle: String {
    let posts = room.messageCount == 1 ? "1 post" : "\(room.messageCount) posts"
    guard let topic = room.topic else { return room.isOpen ? posts : "Closed, \(posts)" }
    return "\(topic), \(posts)"
  }

  var body: some View {
    VStack(spacing: 0) {
      if case .down = store.phase { ReconnectBanner() }
      if let side = store.stale { StaleBanner(side: side) }
      if let block = notifier.windowBlock { NotifyBanner(block: block) }
      RoomHeader(room: room, subtitle: subtitle)
      MemberStrip(
        live: room.liveMembers, away: room.awayMembers,
        asking: Set(room.approvals.map(\.member) + room.questions.map(\.member)),
        mention: room.isOpen ? { mention($0) } : nil,
        setRole: room.isOpen ? { setRole($0, member: $1) } : nil, remove: { remove($0) },
        mute: room.isOpen ? { mute($0) } : nil
      )
      .id(room.name)
      if !room.agreements.isEmpty {
        AgreementsPanel(agreements: room.agreements)
          .id(room.name)
      }
      if !room.approvals.isEmpty {
        ApprovalCards(approvals: room.approvals, answer: answer)
      }
      if !room.questions.isEmpty {
        QuestionCards(questions: room.questions, answer: answer)
      }
      Divider()
      Transcript(
        room: room.name, messages: room.messages.matching(query), members: room.members, query: query,
        columnsChangedAt: columnsChangedAt, older: older, reveal: reveal)
        .id(room.name)
      if room.isOpen {
        PostBox(room: room, store: store, client: client, text: $draft, focused: $composing)
      } else {
        Divider()
        ClosedBar(reopen: { change(.reopen(room.name)) })
      }
    }
    .navigationTitle("#\(room.name)")
    .titleInHeader()
    .searchable(text: $query, placement: .toolbar, prompt: "Filter #\(room.name)")
    .onChange(of: room.name) { query = "" }
    .onChange(of: Seen(room: room.name, lastId: room.messages.last?.id), initial: true) { store.markSeen(room.name) }
    .toolbar {
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

  // A filter reads only the loaded lines, so it never pages.
  private var older: OlderPages {
    let name = room.name
    return OlderPages(
      hasMore: room.hasMore && query.trimmingCharacters(in: .whitespaces).isEmpty,
      loading: store.loadingOlder.contains(name),
      load: { [store, client] in Task { await store.loadOlder(room: name, via: client) } })
  }

  private func toggle() {
    if room.isOpen { confirmingClose = true } else { change(.reopen(room.name)) }
  }

  private func change(_ action: RoomAction) {
    Task { refusal = await store.change(action, via: client) }
  }

  private func setRole(_ role: String, member: String) {
    Task { refusal = await store.setRole(role, member: member, room: room.name, via: client) }
  }

  private func remove(_ members: [String]) {
    Task { refusal = await store.remove(members, room: room.name, via: client) }
  }

  private func mute(_ member: Member) {
    Task { refusal = await store.mute(member.name, muted: !member.muted, room: room.name, via: client) }
  }

  private func answer(_ approval: Approval, allow: Bool) {
    Task { refusal = await store.answer(approval, allow: allow, via: client) }
  }

  private func answer(_ question: Question, option: Int) {
    Task { refusal = await store.answer(question, option: option, via: client) }
  }
}

/// What the shown room has loaded. A change means the human saw it, so the sidebar's unread badge clears.
private struct Seen: Equatable {
  let room: String
  let lastId: Int?
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
          .help("Stays open when agents finish. Only you close it.")
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

struct StaleBanner: View {
  let side: StaleSide

  var body: some View {
    Label(side.reason, systemImage: "arrow.down.app")
      .font(.callout)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 16)
      .padding(.vertical, 8)
      .background(.yellow.opacity(0.15))
  }
}

struct MemberStrip: View {
  let live: [Member]
  let away: [Member]
  let asking: Set<String>
  let mention: ((String) -> Void)?
  let setRole: ((_ role: String, _ member: String) -> Void)?
  let remove: ([String]) -> Void
  let mute: ((Member) -> Void)?
  @State private var showsAway = Self.startsOpen

  #if DEBUG
    private static let startsOpen = ShotHooks.openFolds
  #else
    private static let startsOpen = false
  #endif

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 8) {
        ForEach(live, id: \.name, content: chip)
        if !away.isEmpty {
          AwayChip(
            members: away, open: showsAway, toggle: { withAnimation(.snappy) { showsAway.toggle() } },
            clear: { remove(away.map(\.name)) })
          if showsAway { ForEach(away, id: \.name, content: removable) }
        }
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 10)
    }
  }

  private func chip(_ member: Member) -> some View {
    mentionable(member)
      .contextMenu {
        if let setRole, !member.roleChoices.isEmpty {
          Menu("Role") {
            ForEach(member.roleChoices, id: \.self) { role in
              Button(role.capitalized) { setRole(role, member.name) }
            }
          }
        }
        if let mute, let action = member.muteAction {
          Button(action) { mute(member) }
        }
      }
  }

  private func removable(_ member: Member) -> some View {
    chip(member)
      .overlay(alignment: .topTrailing) {
        Button { remove([member.name]) } label: {
          Image(systemName: "xmark.circle.fill")
            .symbolRenderingMode(.hierarchical)
            .foregroundStyle(.secondary)
        }
        .buttonStyle(.plain)
        .offset(x: 5, y: -5)
        .help("Remove \(member.name) from the room")
        .accessibilityLabel("Remove \(member.name)")
      }
  }

  @ViewBuilder private func mentionable(_ member: Member) -> some View {
    if let mention, member.kind != .human, member.presence != .left {
      Button { mention(member.name) } label: { MemberChip(member: member, asks: asking.contains(member.name)) }
        .buttonStyle(.plain)
        .accessibilityHint("Mentions \(member.name) in your message")
    } else {
      MemberChip(member: member, asks: asking.contains(member.name))
    }
  }
}

/// Away and left agents as one chip with their avatars stacked. A click shows or hides them beside it.
/// Clear All removes them all from the room.
struct AwayChip: View {
  let members: [Member]
  let open: Bool
  let toggle: () -> Void
  let clear: () -> Void

  private static let stackedAvatars = 3

  var body: some View {
    HStack(spacing: 10) {
      fold
      Button("Clear All", action: clear)
        .buttonStyle(.plain)
        .font(.caption.weight(.medium))
        .foregroundStyle(.secondary)
        .help("Remove every away and left agent from the room")
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 6)
    .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
  }

  private var fold: some View {
    Button(action: toggle) {
      HStack(spacing: 8) {
        HStack(spacing: -10) {
          ForEach(members.prefix(Self.stackedAvatars), id: \.name) { member in
            AvatarView(name: member.name, size: 26)
              .overlay(Circle().strokeBorder(.background, lineWidth: 1.5))
          }
        }
        VStack(alignment: .leading, spacing: 1) {
          Text("\(members.count) away")
            .font(.callout.weight(.medium))
          HStack(spacing: 4) {
            Image(systemName: "chevron.right")
              .imageScale(.small)
              .rotationEffect(.degrees(open ? 90 : 0))
            Text(open ? "Hide" : "Show")
          }
          .font(.caption)
          .foregroundStyle(.secondary)
        }
      }
      // One layer before the fade, so a faded avatar never shows through the one on top.
      .compositingGroup()
      .opacity(0.6)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .help(members.map(\.name).joined(separator: ", "))
    .accessibilityLabel("\(members.count) away: \(members.map(\.name).joined(separator: ", "))")
    .accessibilityHint(open ? "Hides them" : "Shows them")
  }
}

struct MemberChip: View {
  let member: Member
  var asks = false

  var body: some View {
    HStack(spacing: 8) {
      AvatarView(name: member.name, size: 26, presence: member.presence)
      VStack(alignment: .leading, spacing: 1) {
        HStack(spacing: 5) {
          Text(member.displayName)
            .font(.callout.weight(.medium))
          if let label = member.clientLabel {
            TypePill(label: label, name: member.name)
          } else if member.kind != .human {
            Image(systemName: member.kind.symbol)
              .imageScale(.small)
              .foregroundStyle(.secondary)
          }
          if let role = member.rolePill {
            RolePill(role: role)
          }
          if member.muted {
            MutedPill()
          }
          if asks {
            AskPill()
          }
        }
        if member.status != nil {
          StatusLine(member: member)
        }
      }
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 6)
    .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
    .opacity(member.presence.isAway || member.isObserver ? 0.6 : 1)
    .help(member.help(as: member.displayName))
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(member.spokenLabel(as: member.displayName))
  }
}

/// The member's own status and its age, after a glyph that spins while the member is active.
/// The age ticks each minute without a feed event. Reduce Motion keeps the glyph and the text still.
struct StatusLine: View {
  let member: Member
  var maxWidth: CGFloat? = 240
  @Environment(\.accessibilityReduceMotion) private var systemReduceMotion

  #if DEBUG
    private var reduceMotion: Bool { systemReduceMotion || ShotHooks.reduceMotion }
  #else
    private var reduceMotion: Bool { systemReduceMotion }
  #endif

  #if DEBUG
    private func glyph(at date: Date, animated: Bool) -> String {
      guard let shot = ShotHooks.glyphFrame else { return Thinking.glyph(at: date, animated: animated) }
      return Thinking.glyph(at: Date(timeIntervalSinceReferenceDate: Double(shot) * Thinking.step), animated: true)
    }
  #else
    private func glyph(at date: Date, animated: Bool) -> String { Thinking.glyph(at: date, animated: animated) }
  #endif

  // The caption style the line uses, so the box fits the glyphs as drawn.
  private static let glyphBox = Thinking.box(for: .preferredFont(forTextStyle: .caption1))

  // The frame is read only while spinning, so a still line never redraws on a tick.
  var body: some View {
    let clock = ThinkingClock.shared
    let animated = member.isThinking && !reduceMotion
    let frame = animated ? clock.frame : .distantPast
    HStack(spacing: 4) {
      Text(glyph(at: frame, animated: animated))
        .foregroundStyle(member.isThinking ? member.presence.color : .secondary)
        .frame(width: Self.glyphBox)
      Text(member.statusLine(now: clock.minute) ?? "")
        .foregroundStyle(animated ? AnyShapeStyle(shimmer(at: frame)) : AnyShapeStyle(.secondary))
        .lineLimit(1)
        .truncationMode(.tail)
    }
    .font(.caption)
    .frame(maxWidth: maxWidth, alignment: .leading)
  }

  // A light band slides across the secondary text, a little past each edge so it fades in and out.
  private func shimmer(at date: Date) -> LinearGradient {
    let center = -0.3 + 1.6 * Thinking.shimmer(at: date)
    return LinearGradient(
      stops: [
        .init(color: .secondary, location: center - 0.2), .init(color: .primary, location: center),
        .init(color: .secondary, location: center + 0.2),
      ], startPoint: .leading, endPoint: .trailing)
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

/// The member's role, outlined only so it reads quieter than the type pill.
struct RolePill: View {
  let role: String

  var body: some View {
    Text(role)
      .font(.subheadline)
      .lineLimit(1)
      .foregroundStyle(.secondary)
      .padding(.horizontal, 6)
      .padding(.vertical, 1)
      .overlay(Capsule().strokeBorder(.secondary.opacity(0.5), lineWidth: 0.5))
  }
}

/// Says the member is muted: it reads, but its posts are refused.
struct MutedPill: View {
  var body: some View {
    Label("muted", systemImage: "speaker.slash.fill")
      .labelStyle(.titleAndIcon)
      .font(.subheadline)
      .fixedSize()
      .foregroundStyle(.orange)
      .padding(.horizontal, 6)
      .padding(.vertical, 1)
      .background(.orange.opacity(0.12), in: Capsule())
  }
}

/// Older pages above the loaded lines: whether there are more, whether one is on its way, and how to ask.
struct OlderPages {
  let hasMore: Bool
  let loading: Bool
  let load: () -> Void
}

/// The height of every row measured so far, by row id. A class, so a measure writes it without a redraw.
@MainActor
final class RowHeights {
  private var byId: [Int: Double] = [:]
  private var guess = RowWindow.defaultHeight
  private var stale = false

  func set(_ height: Double, for id: Int) {
    byId[id] = height
    stale = true
  }

  /// Each row's height, the guess for rows never shown.
  func heights(of rows: [TranscriptItem]) -> [Double] {
    if stale {
      guess = RowWindow.guess(measured: Array(byId.values))
      stale = false
    }
    return rows.map { byId[$0.id] ?? guess }
  }
}

/// The part of the rows stack on screen, in its own coordinates.
private struct Band: Equatable {
  let top: Double
  let bottom: Double

  var height: Double { bottom - top }
}

/// Where rows sat on screen when an older page was asked for. A class, so a scroll writes it without a redraw.
@MainActor
final class ScrollMarks {
  var frames: [Int: CGRect] = [:]
  var viewport = 0.0
  var wantsPage = false
  var pending: (messageId: Int, rowId: Int)?
}

struct Transcript: View {
  let room: String
  let messages: [Message]
  let members: [Member]
  let query: String
  let columnsChangedAt: Date?
  let older: OlderPages
  let reveal: Reveal?
  @State private var nearBottom = true
  @State private var showPill = false
  @State private var opened: [Int: Bool] = [:]
  @State private var marks = ScrollMarks()
  @State private var ready = false
  @State private var anchorRow: Int?
  @State private var flashing: Int?
  /// The ids of the rows built for real, by both ends. Nil until the first scroll geometry lands.
  @State private var window: ClosedRange<Int>?
  @State private var heights = RowHeights()

  private static let end = "end"
  private static let spacing = 6.0
  /// How long the view takes to settle at the bottom after it opens.
  private static let settle = 0.8

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
      let rows = items
      let watched: Set<Int?> = [rows.first?.id, anchorRow]
      let (hasMore, loading) = (older.hasMore, older.loading)
      let real = span(of: rows)
      let rowHeights = heights.heights(of: rows)
      let spacers = RowWindow.spacers(heights: rowHeights, spacing: Self.spacing, window: real)
      let senders = Dictionary(members.map { ($0.name, $0) }, uniquingKeysWith: { first, _ in first })
      ScrollViewReader { proxy in
        ScrollView {
          VStack(spacing: 0) {
            if older.hasMore { OlderPagesRow(loading: older.loading) }
            VStack(alignment: .leading, spacing: Self.spacing) {
              if spacers.above > 0 { Color.clear.frame(height: spacers.above) }
              ForEach(rows[real]) { item in
                Group {
                  switch item {
                  case .message(let message):
                    MessageRow(message: message, sender: senders[message.from])
                  case .fold(let fold):
                    let open = isOpen(fold)
                    FoldRow(fold: fold, open: open) { toggle(fold, to: !open, proxy) }
                  }
                }
                .id(item.id)
                .background(
                  Color.accentColor.opacity(flashing == item.id ? 0.15 : 0), in: RoundedRectangle(cornerRadius: 8)
                )
                .modifier(RowMark(id: item.id, marks: watched.contains(item.id) ? marks : nil))
                .onGeometryChange(for: Double.self) { $0.size.height } action: { heights.set($0, for: item.id) }
              }
              if spacers.below > 0 { Color.clear.frame(height: spacers.below) }
            }
            .onGeometryChange(for: Band.self) { geometry in
              let visible = geometry.bounds(of: .scrollView) ?? .zero
              return Band(top: visible.minY, bottom: visible.maxY)
            } action: { band in
              #if DEBUG
                PerfHooks.note("band \(Int(band.top))...\(Int(band.bottom)) rows \(rows.count) real \(real) at \(Int(CACurrentMediaTime() * 1000) % 100000) ms, hasMore \(hasMore), loading \(loading)")
              #endif
              place(band, rows: rows, heights: rowHeights, real: real)
            }
            .padding(16)
            Color.clear.frame(height: 1).id(Self.end)
          }
          .onGeometryChange(for: TopEdge.self) { geometry in
            let visible = geometry.bounds(of: .scrollView) ?? .zero
            let load = Paging.shouldLoad(
              visibleTop: visible.minY, viewportHeight: visible.height, hasMore: hasMore, loading: loading)
            return TopEdge(load: load, viewport: visible.height)
          } action: { edge in
            marks.viewport = edge.viewport
            marks.wantsPage = edge.load
            if edge.load { loadOlder(rows) }
          }
          // A Bool, so a column slide that keeps the view at the bottom writes no state each frame.
          .onGeometryChange(for: Bool.self) { geometry in
            let visible = geometry.bounds(of: .scrollView) ?? .zero
            return Follow.isNearBottom(
              contentBottom: geometry.size.height - visible.minY, viewportHeight: visible.height)
          } action: { atBottom in
            // The first layout after a room opens can throw the view to the top. Until the view has settled,
            // leaving the bottom is that throw, not a scroll, so the end is put back.
            if nearBottom, !atBottom, !ready { scroll(proxy, animated: false) }
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
        .onChange(of: reveal) { show(reveal, proxy) }
        // The oldest id, not the loading flag: the flag flips before the page lands, with the old rows still in hand.
        .onChange(of: messages.first?.id) { before, after in
          if let before, let after, after < before { keepPlace(proxy) }
        }
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
    // The bottom anchor wins the first layout, so the reveal waits a turn.
    if reveal != nil { DispatchQueue.main.async { show(reveal, proxy) } }
    DispatchQueue.main.async {
      #if DEBUG
        PerfHooks.transcriptDidLayout()
      #endif
    }
    // The view sits at the top for a beat after the bottom lands, so paging waits until it has settled.
    // A page asked for then would keep the place of a top the reader never saw.
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.settle) {
      ready = true
      if marks.wantsPage { loadOlder(items) }
    }
    #if DEBUG
      // The view settles at the bottom first, so the shot scrolls up once that beat has passed.
      if ShotHooks.pageTopNote != nil || ShotHooks.startAtTop {
        Task {
          try? await Task.sleep(for: .seconds(Self.settle + 0.2))
          scrollTo(items.first?.id, anchor: .top, proxy)
        }
      }
    #endif
  }

  /// The row indices built for real: the window's ids, else the newest rows before any geometry landed.
  private func span(of rows: [TranscriptItem]) -> Range<Int> {
    window.map { RowWindow.indices(ofIds: $0, in: rows) } ?? RowWindow.start(count: rows.count)
  }

  /// Moves the window once the band needs rows outside it. A window reaching the newest row stays open at
  /// that end, so a new post is real the moment it lands.
  private func place(_ band: Band, rows: [TranscriptItem], heights: [Double], real: Range<Int>) {
    let needed = RowWindow.range(
      heights: heights, spacing: Self.spacing, top: band.top, bottom: band.bottom, margin: band.height)
    guard !RowWindow.covers(real, needed: needed) else { return }
    let wide = RowWindow.range(
      heights: heights, spacing: Self.spacing, top: band.top, bottom: band.bottom, margin: band.height * 2)
    guard let ids = RowWindow.ids(of: wide, in: rows) else { return }
    window = wide.upperBound == rows.count ? ids.lowerBound...Int.max : ids
    #if DEBUG
      PerfHooks.note("window: rows \(wide) of \(rows.count), band \(Int(band.top))...\(Int(band.bottom))")
    #endif
  }

  /// Scrolls to a row. A row behind a spacer is made real first, since a scroll can only aim at a row that exists.
  private func scrollTo(_ id: Int?, anchor: UnitPoint, _ proxy: ScrollViewProxy, animated: Bool = false) {
    guard let id else { return }
    let rows = items
    let index = RowWindow.indices(ofIds: id...id, in: rows)
    let aim = {
      guard animated else { return proxy.scrollTo(id, anchor: anchor) }
      withAnimation(.easeOut) { proxy.scrollTo(id, anchor: anchor) }
    }
    guard let first = index.first, !span(of: rows).contains(first) else { return aim() }
    window = RowWindow.ids(of: RowWindow.around(first, count: rows.count), in: rows)
    #if DEBUG
      PerfHooks.note("scroll to row \(first) of \(rows.count), made real first")
    #endif
    DispatchQueue.main.async(execute: aim)
  }

  /// Scrolls to the revealed post and lights it up for a moment. A post no longer loaded is skipped.
  private func show(_ reveal: Reveal?, _ proxy: ScrollViewProxy) {
    guard let id = reveal?.messageId, messages.contains(where: { $0.id == id }) else { return }
    scrollTo(id, anchor: .center, proxy, animated: true)
    flashing = id
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
      withAnimation(.easeOut) { if flashing == id { flashing = nil } }
    }
  }

  private func loadOlder(_ rows: [TranscriptItem]) {
    guard ready, marks.pending == nil, let first = messages.first, let row = rows.first else { return }
    #if DEBUG
      PerfHooks.note("page: asked below \(first.id), first row \(row.id)")
    #endif
    marks.pending = (first.id, row.id)
    older.load()
  }

  /// After an older page lands, puts the row that was first back where it was on screen.
  private func keepPlace(_ proxy: ScrollViewProxy) {
    guard let pending = marks.pending else { return }
    marks.pending = nil
    #if DEBUG
      PerfHooks.note("page landed: first \(String(describing: messages.first?.id)), was \(pending.messageId)")
    #endif
    guard let before = marks.frames[pending.rowId], messages.first.map({ $0.id < pending.messageId }) == true,
      let anchor = Paging.anchor(firstMessageId: pending.messageId, in: items)
    else { return }
    anchorRow = anchor
    let aim = Paging.aim(gap: before.minY, rowHeight: before.height, viewportHeight: marks.viewport)
    // The next turn, so the new rows have their sizes before the scroll aims.
    DispatchQueue.main.async {
      scrollTo(anchor, anchor: UnitPoint(x: 0.5, y: aim), proxy)
      #if DEBUG
        if let note = ShotHooks.pageTopNote { noteAnchor(anchor, before: before.minY, to: note, proxy) }
      #endif
    }
  }

  #if DEBUG
    /// Writes where the anchor row sat before and after the page, then shows the oldest lines for the shot.
    private func noteAnchor(_ anchor: Int, before: Double, to file: String, _ proxy: ScrollViewProxy) {
      Task {
        try? await Task.sleep(for: .milliseconds(400))
        let after = marks.frames[anchor]?.minY ?? .nan
        PerfHooks.note("note: anchor \(anchor) after \(after)")
        let text = String(
          format: "anchor row %d top %.1f pt before the page, %.1f pt after, %d messages loaded", anchor, before, after,
          messages.count)
        scrollTo(items.first?.id, anchor: .top, proxy)
        try? await Task.sleep(for: .milliseconds(400))
        try? text.write(toFile: file, atomically: true, encoding: .utf8)
      }
    }
  #endif

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
    #if DEBUG
      PerfHooks.note("scroll to end, animated \(animated), rows \(items.count), window \(String(describing: window)) at \(Int(CACurrentMediaTime() * 1000) % 100000) ms")
    #endif
    showPill = false
    guard animated else {
      proxy.scrollTo(Self.end, anchor: .bottom)
      return
    }
    withAnimation(.easeOut) { proxy.scrollTo(Self.end, anchor: .bottom) }
  }
}

private struct TopEdge: Equatable {
  let load: Bool
  let viewport: Double
}

/// Notes a row's frame on screen, for the rows paging needs to put back in place.
private struct RowMark: ViewModifier {
  let id: Int
  let marks: ScrollMarks?

  func body(content: Content) -> some View {
    if let marks {
      content.onGeometryChange(for: CGRect.self) { $0.frame(in: .scrollView) } action: { marks.frames[id] = $0 }
    } else {
      content
    }
  }
}

/// A thin row above the oldest loaded line. It keeps its height, so the spinner showing never moves the lines.
struct OlderPagesRow: View {
  let loading: Bool

  var body: some View {
    ProgressView()
      .controlSize(.small)
      .opacity(loading ? 1 : 0)
      .frame(maxWidth: .infinity)
      .frame(height: 28)
      .padding(.top, 8)
      .accessibilityLabel("Loading earlier messages")
      .accessibilityHidden(!loading)
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
    #if DEBUG
      let _ = PerfHooks.countRow()
    #endif
    switch message.kind {
    case .system, .unknown:
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

  // Off in Settings, a line has no links to read, so nothing goes to GitHub.
  private var pullRequests: PullRequestRow {
    PullRequestRow(links: AppSettings.shared.snapshot.pullRequestCards ? pullRequestLinks(in: message.text) : [])
  }

  var body: some View {
    let line = message.chatLine(sender: sender)
    let pullRequests = pullRequests
    HStack(alignment: .top, spacing: 10) {
      if !line.mine { AvatarView(name: message.from) }
      VStack(alignment: line.mine ? .trailing : .leading, spacing: 3) {
        HStack(spacing: 6) {
          Text(line.title).fontWeight(.semibold)
          if let label = line.pill {
            TypePill(label: label, name: message.from)
              .help(sender?.client ?? label)
          }
          if let role = sender?.rolePill {
            RolePill(role: role)
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
        PullRequestCards(row: pullRequests)
          .padding(.top, 10)
      }
      if line.mine { AvatarView(name: message.from) }
    }
    .readsPullRequests(pullRequests)
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
  @State private var emptyOn: String?

  private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

  private var candidates: [String] {
    guard text != dismissedOn, let query = mentionQuery(in: text) else { return [] }
    return Array(mentionCandidates(query: query, members: room.members).prefix(6))
  }

  private var selected: String? { pickedMention(highlight, in: candidates) }

  // One text line tall, so the send button centers on the draft's last line, however many lines it has.
  private static let lineHeight: CGFloat = {
    let font = NSFont.preferredFont(forTextStyle: .body)
    return (font.ascender - font.descender + font.leading).rounded(.up)
  }()

  /// The post box floats as one card over the bottom of the room, with the send button inside it.
  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .bottom, spacing: 8) {
        TextField("Message #\(room.name) as human", text: $text, axis: .vertical)
        .textFieldStyle(.plain)
        .lineLimit(1...6)
        .focused(focused)
        .onKeyPress(keys: [.return], phases: .down) { press in
          guard returnSends(press.modifiers) else { return newLine() }
          submit()
          return .handled
        }
        .onKeyPress(.downArrow) { move(by: 1) }
        .onKeyPress(.upArrow) { move(by: -1) }
        .onKeyPress(.tab) { complete() }
        .onKeyPress(.escape) {
          guard !candidates.isEmpty else { return .ignored }
          dismissedOn = text
          return .handled
        }
        Button(action: send) {
          Image(systemName: "arrow.up.circle.fill")
            .font(.title2)
        }
        .buttonStyle(.borderless)
        .frame(height: Self.lineHeight)
        .disabled(trimmed.isEmpty || sending)
        .accessibilityLabel("Send")
        .help("Send as human")
      }
      .padding(.leading, 12)
      .padding(.trailing, 8)
      .padding(.vertical, 10)
      .background(.background, in: RoundedRectangle(cornerRadius: 14))
      .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(.separator))
      .shadow(color: .black.opacity(0.1), radius: 6, y: 2)
      if let refusal {
        Text(refusal)
          .font(.caption)
          .foregroundStyle(.red)
      } else if text == emptyOn {
        Text("Say something after the mention")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
    .padding(.horizontal, 16)
    .padding(.top, 4)
    .padding(.bottom, 12)
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
  // The key never reaches the field, so it cannot also submit or select the draft.
  private func submit() {
    if complete() == .ignored { send() }
  }

  // Let through, Shift Return ends editing and selects the draft, so the line goes in by hand at the caret.
  private func newLine() -> KeyPress.Result {
    let windows = [NSApp.keyWindow].compactMap { $0 } + NSApp.windows
    guard let editor = windows.lazy.compactMap({ $0.firstResponder as? NSTextView }).first else { return .ignored }
    editor.insertNewlineIgnoringFieldEditor(nil)
    return .handled
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
    guard !onlyMentions(trimmed) else {
      emptyOn = text
      return
    }
    let draft = trimmed
    sending = true
    Task {
      refusal = await store.post(draft, room: room.name, via: client)
      if refusal == nil { text = "" }
      sending = false
    }
  }
}
