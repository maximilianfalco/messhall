import Feed
import SwiftUI
import UserNotifications

/// Posts a banner for each live feed event that needs the human. Mutes live in `UserDefaults`.
@MainActor
@Observable
final class Notifier {
  nonisolated static let roomKey = "room"
  private static let enabledKey = "notificationsEnabled"
  private static let mutedKey = "mutedRooms"

  @ObservationIgnored private let defaults = UserDefaults.standard

  var enabled: Bool {
    didSet { defaults.set(enabled, forKey: Self.enabledKey) }
  }

  private(set) var mutedRooms: Set<String> {
    didSet { defaults.set(mutedRooms.sorted(), forKey: Self.mutedKey) }
  }

  init() {
    enabled = defaults.object(forKey: Self.enabledKey) as? Bool ?? true
    mutedRooms = Set(defaults.stringArray(forKey: Self.mutedKey) ?? [])
  }

  func isMuted(_ room: String) -> Bool { mutedRooms.contains(room) }

  func toggleMute(_ room: String) {
    if mutedRooms.remove(room) == nil { mutedRooms.insert(room) }
  }

  /// The system shows its prompt only while the answer is not set, so this asks at most once.
  func requestPermission() {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
  }

  func notify(_ event: BusEvent, room: SnapshotRoom?, liveSince: Date) {
    let state = NotifyState(room: room, mutedRooms: mutedRooms, enabled: enabled, liveSince: liveSince)
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
    if !notifier.enabled { return "Notifications are off in the Messhall menu bar menu" }
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
