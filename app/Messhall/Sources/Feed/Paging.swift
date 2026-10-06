import Foundation

/// When the transcript asks for older messages and how it keeps the reader's place after they land.
public enum Paging {
  /// Messages per older page. The daemon allows up to 200.
  public static let pageSize = 100

  /// True when the view's top is within one screen of the content's top, there is more and no page is on its way.
  /// `visibleTop` is how far the view has scrolled down from the content's top.
  public static func shouldLoad(visibleTop: Double, viewportHeight: Double, hasMore: Bool, loading: Bool) -> Bool {
    hasMore && !loading && visibleTop <= viewportHeight
  }

  /// The row that now holds the message that used to be first. A presence run can grow up into the new page.
  public static func anchor(firstMessageId: Int, in items: [TranscriptItem]) -> Int? {
    items.first { item in
      switch item {
      case .message(let message): message.id == firstMessageId
      case .fold(let fold): fold.messages.contains { $0.id == firstMessageId }
      }
    }?.id
  }

  /// The unit point y for `scrollTo` that puts a row's top `gap` points below the view's top.
  /// `scrollTo` lines up the same fraction of the row and of the view, so the fraction is gap over the spare height.
  public static func aim(gap: Double, rowHeight: Double, viewportHeight: Double) -> Double {
    let spare = viewportHeight - rowHeight
    return spare == 0 ? 0 : gap / spare
  }
}
