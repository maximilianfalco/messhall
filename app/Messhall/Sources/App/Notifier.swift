import Feed
import SwiftUI
import UserNotifications

/// Posts a banner for each live feed event that needs the human. The switch and mutes live in `AppSettings`.
@MainActor
@Observable
final class Notifier {
  nonisolated static let roomKey = "room"

  @ObservationIgnored private let settings: AppSettings

  init(settings: AppSettings) {
    self.settings = settings
  }

  var enabled: Bool {
    get { settings.snapshot.notificationsEnabled }
    set { settings.snapshot.notificationsEnabled = newValue }
  }

  func isMuted(_ room: String) -> Bool { settings.snapshot.mutedRooms.contains(room) }

  func toggleMute(_ room: String) { settings.snapshot.toggleMute(room) }

  /// The system shows its prompt only while the answer is not set, so this asks at most once.
  func requestPermission() {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
  }

  func notify(_ event: BusEvent, room: SnapshotRoom?, liveSince: Date) {
    let state = NotifyState(
      room: room, mutedRooms: settings.snapshot.mutedRooms, enabled: enabled, liveSince: liveSince)
    guard let note = notificationFor(event: event, state: state) else { return }
    let content = UNMutableNotificationContent()
    content.title = note.title
    content.body = note.body
    content.sound = .default
    content.threadIdentifier = note.room
    content.userInfo = [Self.roomKey: note.room]
    UNUserNotificationCenter.current().add(
      UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
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
