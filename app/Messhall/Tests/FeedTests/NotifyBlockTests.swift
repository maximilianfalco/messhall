import Testing
import UserNotifications

@testable import Feed

@Suite("notifyBlock")
struct NotifyBlockTests {
  @Test func allowedWithBannersIsNoBlock() {
    #expect(notifyBlock(status: .authorized, alerts: .enabled, style: .banner) == nil)
    #expect(notifyBlock(status: .authorized, alerts: .enabled, style: .alert) == nil)
  }

  @Test func deniedIsDenied() {
    #expect(notifyBlock(status: .denied, alerts: .disabled, style: .none) == .denied)
  }

  @Test func neverAskedIsNotAsked() {
    #expect(notifyBlock(status: .notDetermined, alerts: .notSupported, style: .none) == .notAsked)
  }

  @Test func alertsOffIsAlertsOff() {
    #expect(notifyBlock(status: .authorized, alerts: .disabled, style: .banner) == .alertsOff)
  }

  @Test func noAlertStyleIsAlertsOff() {
    #expect(notifyBlock(status: .authorized, alerts: .enabled, style: .none) == .alertsOff)
  }

  @Test func quietDeliveryIsAlertsOff() {
    #expect(notifyBlock(status: .provisional, alerts: .disabled, style: .none) == .alertsOff)
  }

  @Test func eachBlockSaysMacOSIsBlocking() {
    for block in NotifyBlock.allCases {
      #expect(block.notice.hasPrefix("macOS is blocking Messhall's notifications"))
    }
  }

  @Test func onlyNotAskedCanAskAgain() {
    #expect(NotifyBlock.allCases.filter(\.canAsk) == [.notAsked])
  }
}
