import Foundation

/// The human's seat name, the same in every room.
public let humanName = "human"
/// How the app names the human to the human.
public let youLabel = "You"

/// What one chat row shows. The human's own lines sit on the right under `You`.
public struct ChatLine: Equatable, Sendable {
  public var title: String
  public var text: String
  public var mine: Bool
  public var pill: String?
}

extension Message {
  public func chatLine(sender: Member?) -> ChatLine {
    let mine = from == humanName
    return ChatLine(title: mine ? youLabel : from, text: text, mine: mine, pill: typeLabel(sender: sender))
  }
}
