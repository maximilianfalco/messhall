import Foundation

/// What one `app-perf` run measured on the big seeded room. Written as JSON for the dev tool's table.
public struct PerfReport: Codable, Equatable, Sendable {
  /// From picking the room to its first laid out transcript.
  public var openMs: Double
  /// Process cpu over 5 quiet seconds with the spinners running.
  public var idleCpuPercent: Double
  public var pages: Int
  public var rows: Int
  public var pageAllMs: Double
  public var pageAllCpuMs: Double
  /// A paced scroll, a fast flick's speed.
  public var scrollFps: Double
  public var scrollWorstFrameMs: Double
  /// The whole transcript in the same time, far past any hand.
  public var dashFps: Double
  public var dashWorstFrameMs: Double
  /// Frames while the sidebar hides and shows again, over the two slides.
  public var sidebarFps: Double
  public var sidebarWorstFrameMs: Double
  /// The same two slides with the agents panel open beside the room.
  public var panelFps: Double
  public var panelWorstFrameMs: Double
  public var events: Int
  public var eventCpuMs: Double
  public var eventRowBodies: Double
  public var eventWallMs: Double
  /// Keys typed into a multi question form's Other box, and what each one cost.
  public var questionKeys: Int
  public var questionKeyCpuMs: Double
  public var questionKeyRowBodies: Double
  public var questionKeyWorstFrameMs: Double
  /// Clicks on a multi question form's option rows, and what each one cost.
  public var questionPicks: Int
  public var questionPickCpuMs: Double
  public var questionPickRowBodies: Double
  public var questionPickWorstFrameMs: Double
  public var pullRequestReads: Int
  public var residentMb: Double

  public init(
    openMs: Double, idleCpuPercent: Double, pages: Int, rows: Int, pageAllMs: Double, pageAllCpuMs: Double,
    scrollFps: Double, scrollWorstFrameMs: Double, dashFps: Double, dashWorstFrameMs: Double, sidebarFps: Double,
    sidebarWorstFrameMs: Double, panelFps: Double, panelWorstFrameMs: Double, events: Int,
    eventCpuMs: Double, eventRowBodies: Double, eventWallMs: Double, questionKeys: Int, questionKeyCpuMs: Double,
    questionKeyRowBodies: Double, questionKeyWorstFrameMs: Double, questionPicks: Int, questionPickCpuMs: Double,
    questionPickRowBodies: Double, questionPickWorstFrameMs: Double, pullRequestReads: Int, residentMb: Double
  ) {
    self.dashFps = dashFps
    self.dashWorstFrameMs = dashWorstFrameMs
    self.sidebarFps = sidebarFps
    self.sidebarWorstFrameMs = sidebarWorstFrameMs
    self.panelFps = panelFps
    self.panelWorstFrameMs = panelWorstFrameMs
    self.openMs = openMs
    self.idleCpuPercent = idleCpuPercent
    self.pages = pages
    self.rows = rows
    self.pageAllMs = pageAllMs
    self.pageAllCpuMs = pageAllCpuMs
    self.scrollFps = scrollFps
    self.scrollWorstFrameMs = scrollWorstFrameMs
    self.events = events
    self.eventCpuMs = eventCpuMs
    self.eventRowBodies = eventRowBodies
    self.eventWallMs = eventWallMs
    self.questionKeys = questionKeys
    self.questionKeyCpuMs = questionKeyCpuMs
    self.questionKeyRowBodies = questionKeyRowBodies
    self.questionKeyWorstFrameMs = questionKeyWorstFrameMs
    self.questionPicks = questionPicks
    self.questionPickCpuMs = questionPickCpuMs
    self.questionPickRowBodies = questionPickRowBodies
    self.questionPickWorstFrameMs = questionPickWorstFrameMs
    self.pullRequestReads = pullRequestReads
    self.residentMb = residentMb
  }

  enum CodingKeys: String, CodingKey {
    case pages, rows, events
    case openMs = "open_ms"
    case idleCpuPercent = "idle_cpu_percent"
    case pageAllMs = "page_all_ms"
    case pageAllCpuMs = "page_all_cpu_ms"
    case scrollFps = "scroll_fps"
    case scrollWorstFrameMs = "scroll_worst_frame_ms"
    case dashFps = "dash_fps"
    case dashWorstFrameMs = "dash_worst_frame_ms"
    case sidebarFps = "sidebar_fps"
    case sidebarWorstFrameMs = "sidebar_worst_frame_ms"
    case panelFps = "panel_fps"
    case panelWorstFrameMs = "panel_worst_frame_ms"
    case eventCpuMs = "event_cpu_ms"
    case eventRowBodies = "event_row_bodies"
    case eventWallMs = "event_wall_ms"
    case questionKeys = "question_keys"
    case questionKeyCpuMs = "question_key_cpu_ms"
    case questionKeyRowBodies = "question_key_row_bodies"
    case questionKeyWorstFrameMs = "question_key_worst_frame_ms"
    case questionPicks = "question_picks"
    case questionPickCpuMs = "question_pick_cpu_ms"
    case questionPickRowBodies = "question_pick_row_bodies"
    case questionPickWorstFrameMs = "question_pick_worst_frame_ms"
    case pullRequestReads = "pull_request_reads"
    case residentMb = "resident_mb"
  }
}

public enum Perf {
  /// Cpu time as a percent of wall time. Zero wall time reads as zero, not infinity.
  public static func percent(cpuSeconds: Double, wallSeconds: Double) -> Double {
    wallSeconds > 0 ? cpuSeconds / wallSeconds * 100 : 0
  }

  public static func fps(frames: Int, seconds: Double) -> Double {
    seconds > 0 ? Double(frames) / seconds : 0
  }
}
