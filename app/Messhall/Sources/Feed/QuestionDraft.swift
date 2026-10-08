import Foundation

/// The human's answer to an open ask while they fill it in: picks and typed text per question.
public struct QuestionDraft: Equatable, Sendable {
  private struct Entry: Equatable, Sendable {
    var picks: Set<Int> = []
    var other = ""
    var otherOn = false
  }

  private let items: [QuestionItem]
  private var entries: [Entry]

  public init(items: [QuestionItem]) {
    self.items = items
    entries = items.map { _ in Entry() }
  }

  public func isPicked(_ option: Int, in item: Int) -> Bool { entries[item].picks.contains(option) }

  public func other(in item: Int) -> String { entries[item].other }

  /// True while the typed text counts as part of the answer.
  public func isOtherPicked(in item: Int) -> Bool { entries[item].otherOn }

  /// A pick one question keeps one choice, so a pick there also sets the typed text aside.
  public mutating func toggle(_ option: Int, in item: Int) {
    if items[item].multiSelect {
      if entries[item].picks.remove(option) == nil { entries[item].picks.insert(option) }
    } else {
      entries[item].picks = [option]
      entries[item].otherOn = false
    }
  }

  /// Typing on a pick one question makes the typed text its one choice.
  public mutating func setOther(_ text: String, in item: Int) {
    entries[item].other = text
    entries[item].otherOn = !Self.trim(text).isEmpty
    if !items[item].multiSelect, entries[item].otherOn { entries[item].picks = [] }
  }

  /// One answer per question, or nil while any question has neither a pick nor typed text.
  public var answers: [QuestionAnswer]? {
    let answers = entries.map { entry in
      QuestionAnswer(picks: entry.picks.sorted(), other: entry.otherOn ? Self.trim(entry.other) : nil)
    }
    return answers.allSatisfy { !$0.picks.isEmpty || $0.other != nil } ? answers : nil
  }

  private static func trim(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
}

extension Question {
  /// What the human picked, as the answer line names it: each header with its picks, typed text in quotes.
  public var picked: String? {
    guard let answers else { return nil }
    return zip(items, answers).map { item, answer in
      let words = answer.picks.compactMap { item.options.indices.contains($0) ? item.options[$0].label : nil }
        + (answer.other.map { ["\"\($0)\""] } ?? [])
      let picks = words.joined(separator: ", ")
      return item.header.map { "\($0): \(picks)" } ?? picks
    }.joined(separator: " · ")
  }
}
