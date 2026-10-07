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
  public var events: Int
  public var eventCpuMs: Double
  public var eventRowBodies: Double
  public var eventWallMs: Double
  public var pullRequestReads: Int
  public var residentMb: Double

  public init(
    openMs: Double, idleCpuPercent: Double, pages: Int, rows: Int, pageAllMs: Double, pageAllCpuMs: Double,
    scrollFps: Double, scrollWorstFrameMs: Double, dashFps: Double, dashWorstFrameMs: Double, sidebarFps: Double,
    sidebarWorstFrameMs: Double, events: Int,
    eventCpuMs: Double, eventRowBodies: Double, eventWallMs: Double, pullRequestReads: Int, residentMb: Double
  ) {
    self.dashFps = dashFps
    self.dashWorstFrameMs = dashWorstFrameMs
    self.sidebarFps = sidebarFps
    self.sidebarWorstFrameMs = sidebarWorstFrameMs
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
    case eventCpuMs = "event_cpu_ms"
    case eventRowBodies = "event_row_bodies"
    case eventWallMs = "event_wall_ms"
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
