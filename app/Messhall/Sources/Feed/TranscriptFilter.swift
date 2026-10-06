import Foundation

extension Array where Element == Message {
  /// Messages whose text or sender has the query, any case. A blank query keeps them all.
  public func matching(_ query: String) -> [Message] {
    let needle = query.trimmingCharacters(in: .whitespaces)
    guard !needle.isEmpty else { return self }
    return filter { $0.text.localizedCaseInsensitiveContains(needle) || $0.from.localizedCaseInsensitiveContains(needle) }
  }
}
