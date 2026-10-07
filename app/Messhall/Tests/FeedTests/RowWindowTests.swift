import Foundation
import Testing

@testable import Feed

private func line(_ id: Int, kind: MessageKind = .chat) -> Message {
  Message(
    id: id, roomId: "r1", from: kind == .system ? "messhall" : "api", kind: kind, text: "hi", mentions: [],
    createdAt: "2026-01-01T09:00:00.000Z")
}

@Suite("Row window")
struct RowWindowTests {
  @Test("the rows that meet the band, counting the spacing between rows")
  func range() {
    let heights = [Double](repeating: 10, count: 30)
    #expect(RowWindow.range(heights: heights, spacing: 0, top: 100, bottom: 200, margin: 0) == 10..<20)
    #expect(RowWindow.range(heights: [10, 10, 10], spacing: 5, top: 12, bottom: 28, margin: 0) == 1..<2)
  }

  @Test("the margin reaches above and below the band")
  func margin() {
    #expect(RowWindow.range(heights: [10, 10, 10], spacing: 5, top: 12, bottom: 28, margin: 10) == 0..<3)
  }

  @Test("a band past the rows is empty, never out of bounds")
  func past() {
    #expect(RowWindow.range(heights: [10, 10, 10], spacing: 0, top: 1000, bottom: 1100, margin: 0) == 3..<3)
    #expect(RowWindow.range(heights: [], spacing: 0, top: 0, bottom: 100, margin: 0) == 0..<0)
  }

  @Test("the spacers stand in for the rows outside the window, spacing included")
  func spacers() {
    let heights = [10.0, 20, 30, 40, 50]
    #expect(RowWindow.spacers(heights: heights, spacing: 6, window: 2..<4) == (above: 36, below: 50))
    #expect(RowWindow.spacers(heights: heights, spacing: 6, window: 0..<5) == (above: 0, below: 0))
    #expect(RowWindow.spacers(heights: heights, spacing: 6, window: 5..<5) == (above: 174, below: 0))
  }

  @Test("a window keeps while it still covers what the band needs, else it widens around the band")
  func keeps() {
    #expect(RowWindow.covers(10..<20, needed: 12..<18))
    #expect(RowWindow.covers(10..<20, needed: 10..<20))
    #expect(!RowWindow.covers(10..<20, needed: 8..<18))
    #expect(!RowWindow.covers(10..<20, needed: 12..<21))
  }

  @Test("a window of ids resolves to row indices, so a page above it leaves the same rows real")
  func ids() {
    let rows = [3, 4, 7, 9, 12].map { TranscriptItem.message(line($0)) }
    #expect(RowWindow.indices(ofIds: 4...9, in: rows) == 1..<4)
    #expect(RowWindow.indices(ofIds: 5...8, in: rows) == 2..<3)
    #expect(RowWindow.indices(ofIds: 20...30, in: rows) == 5..<5)
    #expect(RowWindow.ids(of: 1..<4, in: rows) == 4...9)
    #expect(RowWindow.ids(of: 2..<2, in: rows) == nil)
  }

  @Test("a short transcript is all real, a long one starts with its newest rows")
  func start() {
    #expect(RowWindow.start(count: 50) == 0..<50)
    #expect(RowWindow.start(count: RowWindow.eagerBelow) == 0..<RowWindow.eagerBelow)
    #expect(RowWindow.start(count: 5000) == (5000 - RowWindow.first)..<5000)
  }

  @Test("a window around one row holds the newest-row count, clipped at both ends")
  func around() {
    #expect(RowWindow.around(100, count: 5000) == 80..<120)
    #expect(RowWindow.around(5, count: 5000) == 0..<25)
    #expect(RowWindow.around(4990, count: 5000) == 4970..<5000)
  }

  @Test("the guess for an unmeasured row is the middle measured height, else the default")
  func guess() {
    #expect(RowWindow.guess(measured: []) == RowWindow.defaultHeight)
    #expect(RowWindow.guess(measured: [10, 50, 30]) == 30)
    #expect(RowWindow.guess(measured: [10, 50, 30, 40]) == 40)
  }
}
