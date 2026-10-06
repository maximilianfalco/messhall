import UserNotifications

/// Why macOS drops Messhall's banners. The raw value is what `-shotNotify` takes.
public enum NotifyBlock: String, CaseIterable, Sendable {
  case denied
  case notAsked
  case alertsOff

  /// One line for the window and Settings.
  public var notice: String {
    switch self {
    case .denied: "macOS is blocking Messhall's notifications."
    case .notAsked: "macOS is blocking Messhall's notifications until you allow them."
    case .alertsOff: "macOS is blocking Messhall's notifications: banners are off for it."
    }
  }

  /// macOS shows its prompt only before the first answer, so only then can the app ask. Else it is System Settings.
  public var canAsk: Bool { self == .notAsked }
}

/// The block in macOS's notification settings for this app, or nil when banners get through.
public func notifyBlock(status: UNAuthorizationStatus, alerts: UNNotificationSetting, style: UNAlertStyle)
  -> NotifyBlock?
{
  switch status {
  case .denied: return .denied
  case .notDetermined: return .notAsked
  default: return alerts == .enabled && style != .none ? nil : .alertsOff
  }
}
