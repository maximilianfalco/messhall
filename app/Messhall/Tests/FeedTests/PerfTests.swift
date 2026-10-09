import Foundation
import Testing

@testable import Feed

@Suite("Perf report")
struct PerfTests {
  @Test("cpu percent is cpu time over wall time")
  func percent() {
    #expect(Perf.percent(cpuSeconds: 0.5, wallSeconds: 10) == 5)
    #expect(Perf.percent(cpuSeconds: 1, wallSeconds: 0) == 0)
  }

  @Test("fps is frames over seconds")
  func fps() {
    #expect(Perf.fps(frames: 240, seconds: 4) == 60)
    #expect(Perf.fps(frames: 10, seconds: 0) == 0)
  }

  @Test("the report writes snake case keys the dev tool reads")
  func keys() throws {
    let report = PerfReport(
      openMs: 120, idleCpuPercent: 1.5, pages: 50, rows: 5000, pageAllMs: 3000, pageAllCpuMs: 2500,
      scrollFps: 59.5, scrollWorstFrameMs: 30, dashFps: 12, dashWorstFrameMs: 110,
      sidebarFps: 58, sidebarWorstFrameMs: 40, panelFps: 57, panelWorstFrameMs: 42,
      events: 50, eventCpuMs: 2.5,
      eventRowBodies: 20, eventWallMs: 400, questionKeys: 20, questionKeyCpuMs: 30, questionKeyRowBodies: 40,
      questionKeyWorstFrameMs: 80, questionPicks: 6, questionPickCpuMs: 45, questionPickRowBodies: 41,
      questionPickWorstFrameMs: 90, pullRequestReads: 3, residentMb: 300)
    let data = try JSONEncoder().encode(report)
    let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])

    #expect(
      Set(json.keys) == [
        "open_ms", "idle_cpu_percent", "pages", "rows", "page_all_ms", "page_all_cpu_ms", "scroll_fps",
        "scroll_worst_frame_ms", "dash_fps", "dash_worst_frame_ms", "sidebar_fps",
        "sidebar_worst_frame_ms", "panel_fps", "panel_worst_frame_ms", "events", "event_cpu_ms", "event_row_bodies",
        "event_wall_ms", "question_keys", "question_key_cpu_ms", "question_key_row_bodies",
        "question_key_worst_frame_ms", "question_picks", "question_pick_cpu_ms", "question_pick_row_bodies",
        "question_pick_worst_frame_ms", "pull_request_reads", "resident_mb",
      ])
    #expect(try JSONDecoder().decode(PerfReport.self, from: data) == report)
  }
}
