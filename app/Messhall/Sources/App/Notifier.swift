import Feed
import SwiftUI
import UserNotifications

/// Posts a banner for each live feed event that needs the human. The switch and mutes live in `AppSettings`.
@MainActor
@Observable
final class Notifier {
  nonisolated static let roomKey = "room"
  nonisolated static let questionKey = "question"
  // A shot app never asks and shows only the block it is told, so no prompt pops up and no shot hangs on this Mac.
  #if DEBUG
    private static let isShot = ShotHooks.isShot
  #else
    private static let isShot = false
  #endif

  @ObservationIgnored private let settings: AppSettings
  /// What macOS does with our banners, read on launch and each time the app comes forward.
  private(set) var block: NotifyBlock?
  /// One category per open question with a banner. Setting categories replaces the whole set, so all are kept here.
  @ObservationIgnored private var questionCategories: [String: UNNotificationCategory] = [:]

  init(settings: AppSettings) {
    self.settings = settings
  }

  var enabled: Bool {
    get { settings.snapshot.notificationsEnabled }
    set { settings.snapshot.notificationsEnabled = newValue }
  }

  func isMuted(_ room: String) -> Bool { settings.snapshot.mutedRooms.contains(room) }

  func toggleMute(_ room: String) { settings.snapshot.toggleMute(room) }

  /// The block worth showing in the window. With Messhall's own switch off, no banner is the plan.
  var windowBlock: NotifyBlock? { enabled ? block : nil }

  /// The system shows its prompt only while the answer is not set, so this asks at most once.
  func requestPermission() async {
    if !Self.isShot {
      _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
    }
    await refreshBlock()
  }

  func refreshBlock() async {
    #if DEBUG
      if Self.isShot {
        block = ShotHooks.notifyBlock
        return
      }
    #endif
    let current = await UNUserNotificationCenter.current().notificationSettings()
    block = notifyBlock(status: current.authorizationStatus, alerts: current.alertSetting, style: current.alertStyle)
  }

  func openSystemSettings() {
    let id = Bundle.main.bundleIdentifier ?? ""
    guard let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=\(id)") else {
      return
    }
    NSWorkspace.shared.open(url)
  }

  /// Skips the switch and the mutes on purpose: it checks only what macOS does.
  func sendTest() {
    post(title: "Messhall", body: "Test notification. Banners work.", room: nil)
  }

  func notify(_ event: BusEvent, room: SnapshotRoom?, liveSince: Date, starting: Set<String>) {
    if let question = bannerToClear(for: event) { clear(question) }
    let state = NotifyState(
      room: room, mutedRooms: settings.snapshot.mutedRooms, enabled: enabled, liveSince: liveSince,
      starting: starting)
    guard let note = notificationFor(event: event, state: state) else { return }
    if let question = note.questionId { offer(note.options, for: question) }
    post(title: note.title, body: note.body, room: note.room, question: note.questionId)
  }

  /// Says why a pick from a banner did not go through, since no window is there to show it.
  func refused(_ reason: String, room: String) {
    post(title: "#\(room)", body: "Could not answer: \(reason)", room: room)
  }

  private func offer(_ options: [String], for question: String) {
    let actions = options.enumerated().map { UNNotificationAction(identifier: optionAction($0), title: $1) }
    questionCategories[question] = UNNotificationCategory(
      identifier: questionCategory(question), actions: actions, intentIdentifiers: [])
    UNUserNotificationCenter.current().setNotificationCategories(Set(questionCategories.values))
  }

  // The banner's buttons would only get a refusal once the question is closed.
  private func clear(_ question: String) {
    UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [question])
    guard questionCategories.removeValue(forKey: question) != nil else { return }
    UNUserNotificationCenter.current().setNotificationCategories(Set(questionCategories.values))
  }

  /// A question's banner takes the question id as its own, so it can be cleared once the question closes.
  private func post(title: String, body: String, room: String?, question: String? = nil) {
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.sound = .default
    if let room {
      content.threadIdentifier = room
      content.userInfo[Self.roomKey] = room
    }
    if let question {
      content.categoryIdentifier = questionCategory(question)
      content.userInfo[Self.questionKey] = question
    }
    UNUserNotificationCenter.current().add(
      UNNotificationRequest(identifier: question ?? UUID().uuidString, content: content, trigger: nil))
  }
}

struct MuteButton: View {
  let room: String
  @Environment(Notifier.self) private var notifier

  private var help: String {
    if !notifier.enabled { return "Notifications are off in Messhall Settings" }
    return notifier.isMuted(room) ? "Notifications for #\(room) are off" : "Turn off notifications for #\(room)"
  }

  var body: some View {
    let muted = notifier.isMuted(room) || !notifier.enabled
    Button {
      notifier.toggleMute(room)
    } label: {
      Label(muted ? "Unmute Room" : "Mute Room", systemImage: muted ? "bell.slash" : "bell")
    }
    .disabled(!notifier.enabled)
    .help(help)
  }
}

/// The fix for a block: the macOS prompt while it can still show, else System Settings.
struct NotifyFixButton: View {
  let block: NotifyBlock
  @Environment(Notifier.self) private var notifier

  var body: some View {
    if block.canAsk {
      Button("Allow Notifications") { Task { await notifier.requestPermission() } }
    } else {
      Button("Open System Settings") { notifier.openSystemSettings() }
    }
  }
}

/// A one-line strip over the room while macOS drops the app's banners.
struct NotifyBanner: View {
  let block: NotifyBlock

  var body: some View {
    HStack {
      Label(block.notice, systemImage: "bell.slash")
        .lineLimit(1)
      Spacer()
      NotifyFixButton(block: block)
        .controlSize(.small)
    }
    .font(.callout)
    .padding(.horizontal, 16)
    .padding(.vertical, 6)
    .background(.orange.opacity(0.15))
  }
}
