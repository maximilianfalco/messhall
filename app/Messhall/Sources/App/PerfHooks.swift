#if DEBUG
  import AppKit
  import Feed
  import QuartzCore
  import SwiftUI

  /// Debug-only driver for `pnpm messhall-dev app-perf`: opens the big room, measures it and writes a JSON report.
  @MainActor
  enum PerfHooks {
    /// `-shotPerf <file>`: where the report goes. `<file>.ready` lands when the app waits for the post burst.
    static let file = UserDefaults.standard.string(forKey: "shotPerf")
    /// `-shotPerfRoom <name>`: the room to open and measure, after the window opened on another one.
    static let room = UserDefaults.standard.string(forKey: "shotPerfRoom") ?? "perf"
    /// `-shotPerfEvents <n>`: how many posts the dev tool sends once `.ready` lands.
    static let events = UserDefaults.standard.integer(forKey: "shotPerfEvents")
    static let idleSeconds = 5.0
    static let scrollSeconds = 4.0
    /// Points per second of the paced scroll, a fast flick. The dash covers the whole transcript in the same time.
    static let scrollPace = 3000.0
    static let settle = Duration.milliseconds(500)

    /// How many times a transcript row built its body. Counted everywhere, read only here.
    static var rowBodies = 0
    static var pullRequestReads = 0
    private static var transcriptLaidOut: CheckedContinuation<Void, Never>?

    static func countRow() {
      rowBodies += 1
    }

    /// The transcript calls this once its first layout is done.
    static func transcriptDidLayout() {
      transcriptLaidOut?.resume()
      transcriptLaidOut = nil
    }

    static func run(store: FeedStore, client: FeedClient, navigation: Navigation, file: String) async {
      while !store.loaded { try? await Task.sleep(for: .milliseconds(50)) }
      while mainWindow == nil { try? await Task.sleep(for: .milliseconds(50)) }
      // A covered window draws only a few frames a second, so the run floats it on top, still without focus.
      mainWindow?.collectionBehavior.formUnion([.canJoinAllSpaces, .fullScreenAuxiliary])
      mainWindow?.level = .floating
      mainWindow?.orderFrontRegardless()
      try? await Task.sleep(for: .seconds(1))

      let openStart = CACurrentMediaTime()
      navigation.room = room
      await withCheckedContinuation { transcriptLaidOut = $0 }
      let openMs = (CACurrentMediaTime() - openStart) * 1000

      try? await Task.sleep(for: .seconds(1))
      let idleCpuPercent = await idleCpu()

      let pageStart = CACurrentMediaTime()
      let pageCpuStart = cpuSeconds()
      var pages = 0
      while store.room(named: room)?.hasMore == true {
        await store.loadOlder(room: room, via: client)
        pages += 1
      }
      let pageAllMs = (CACurrentMediaTime() - pageStart) * 1000
      try? await Task.sleep(for: settle)
      let pageAllCpuMs = (cpuSeconds() - pageCpuStart) * 1000
      let rows = store.room(named: room)?.messages.count ?? 0

      let scroll = await scrollFromTop(points: scrollPace * scrollSeconds)
      let dash = await scrollFromTop(points: .infinity)

      FileManager.default.createFile(atPath: file + ".ready", contents: nil)
      let burst = await awaitBurst(store: store)

      let report = PerfReport(
        openMs: openMs, idleCpuPercent: idleCpuPercent, pages: pages, rows: rows, pageAllMs: pageAllMs,
        pageAllCpuMs: pageAllCpuMs, scrollFps: Perf.fps(frames: scroll.frames, seconds: scrollSeconds),
        scrollWorstFrameMs: scroll.worstGap * 1000, dashFps: Perf.fps(frames: dash.frames, seconds: scrollSeconds),
        dashWorstFrameMs: dash.worstGap * 1000, events: events, eventCpuMs: burst.cpuMs,
        eventRowBodies: burst.rowBodies, eventWallMs: burst.wallMs, pullRequestReads: pullRequestReads,
        residentMb: Double(residentBytes()) / 1_000_000)
      try? JSONEncoder().encode(report).write(to: URL(fileURLWithPath: file))
    }

    private static var mainWindow: NSWindow? {
      NSApp.windows.first { $0.isVisible && $0.styleMask.contains(.titled) }
    }

    private static func idleCpu() async -> Double {
      let cpu = cpuSeconds()
      let wall = CACurrentMediaTime()
      try? await Task.sleep(for: .seconds(idleSeconds))
      return Perf.percent(cpuSeconds: cpuSeconds() - cpu, wallSeconds: CACurrentMediaTime() - wall)
    }

    /// Scrolls the transcript down from its top, `points` far or to its bottom, one step per display frame over
    /// `scrollSeconds`. A frame the main thread misses never ticks, so the tick count is the frame rate.
    private static func scrollFromTop(points: Double) async -> (frames: Int, worstGap: Double) {
      let windows = NSApp.windows.map { "\(type(of: $0)) visible=\($0.isVisible) titled=\($0.styleMask.contains(.titled))" }
      note("windows: \(windows.joined(separator: ", "))")
      guard let content = mainWindow?.contentView else { return note("no main window", giving: (0, 0)) }
      let found = scrollViews(in: content).map { "\(type(of: $0)) doc=\($0.documentView?.frame.height ?? -1)" }
      note("scroll views: \(found.joined(separator: ", "))")
      guard let scrollView = transcriptScrollView(in: content), let document = scrollView.documentView else {
        return note("no transcript scroll view", giving: (0, 0))
      }
      let clip = scrollView.contentView
      let span = min(points, max(0, document.frame.height - clip.bounds.height))
      let height = document.frame.height - clip.bounds.height
      let (top, bottom) = document.isFlipped ? (0.0, span) : (height, height - span)
      clip.scroll(to: NSPoint(x: 0, y: top))
      scrollView.reflectScrolledClipView(clip)
      try? await Task.sleep(for: settle)

      let run = ScrollRun()
      let link = content.displayLink(target: run, selector: #selector(ScrollRun.tick))
      await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
        run.onTick = { elapsed in
          let progress = min(1, elapsed / scrollSeconds)
          clip.scroll(to: NSPoint(x: 0, y: top + (bottom - top) * progress))
          scrollView.reflectScrolledClipView(clip)
          if progress >= 1 {
            link.invalidate()
            run.onTick = nil
            done.resume()
          }
        }
        link.add(to: .main, forMode: .common)
      }
      note("scroll: \(run.frames) frames over \(span) pt, worst gap \(run.worstGap * 1000) ms")
      return (run.frames, run.worstGap)
    }

    private static func scrollViews(in view: NSView) -> [NSScrollView] {
      ((view as? NSScrollView).map { [$0] } ?? []) + view.subviews.flatMap(scrollViews)
    }

    /// The scroll view with the tallest content, which is the transcript once it holds the loaded pages.
    private static func transcriptScrollView(in view: NSView) -> NSScrollView? {
      scrollViews(in: view).max { ($0.documentView?.frame.height ?? 0) < ($1.documentView?.frame.height ?? 0) }
    }

    /// Appends one line to `<file>.log`, so a run that measured nothing says why.
    static func note(_ text: String) {
      guard let file else { return }
      let line = Data((text + "\n").utf8)
      if let handle = FileHandle(forWritingAtPath: file + ".log") {
        handle.seekToEndOfFile()
        handle.write(line)
        handle.closeFile()
      } else {
        FileManager.default.createFile(atPath: file + ".log", contents: line)
      }
    }

    private static func note<T>(_ text: String, giving value: T) -> T {
      note(text)
      return value
    }

    /// Waits for the burst of posts the dev tool sends, measuring from the first one landing to a settle after the last.
    private static func awaitBurst(store: FeedStore) async -> (cpuMs: Double, rowBodies: Double, wallMs: Double) {
      let before = store.room(named: room)?.messageCount ?? 0
      var seen = 0
      var cpuAtFirst = 0.0
      var wallAtFirst = 0.0
      var bodiesAtFirst = 0
      while seen < events {
        await nextChange(of: store)
        let count = (store.room(named: room)?.messageCount ?? 0) - before
        if count > 0, seen == 0 {
          cpuAtFirst = cpuSeconds()
          wallAtFirst = CACurrentMediaTime()
          bodiesAtFirst = rowBodies
        }
        seen = count
      }
      let wallMs = (CACurrentMediaTime() - wallAtFirst) * 1000
      try? await Task.sleep(for: settle)
      let count = Double(max(1, events))
      note("burst: \(rowBodies - bodiesAtFirst) row bodies for \(events) posts, \(wallMs) ms wall")
      return ((cpuSeconds() - cpuAtFirst) * 1000 / count, Double(rowBodies - bodiesAtFirst) / count, wallMs)
    }

    private static func nextChange(of store: FeedStore) async {
      await withCheckedContinuation { continuation in
        withObservationTracking {
          _ = store.rooms
        } onChange: {
          continuation.resume()
        }
      }
    }

    private static func cpuSeconds() -> Double {
      Double(clock_gettime_nsec_np(CLOCK_PROCESS_CPUTIME_ID)) / 1e9
    }

    private static func residentBytes() -> UInt64 {
      var info = mach_task_basic_info()
      var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<natural_t>.size)
      let result = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
          task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
        }
      }
      return result == KERN_SUCCESS ? info.resident_size : 0
    }
  }

  /// Counts display frames while a scripted scroll runs, and the longest gap between two of them.
  @MainActor
  private final class ScrollRun: NSObject {
    var onTick: ((Double) -> Void)?
    private(set) var frames = 0
    private(set) var worstGap = 0.0
    private var start: Double?
    private var last = 0.0

    @objc func tick(_ link: CADisplayLink) {
      let now = CACurrentMediaTime()
      let start = start ?? now
      self.start = start
      if frames > 0 { worstGap = max(worstGap, now - last) }
      last = now
      frames += 1
      onTick?(now - start)
    }
  }
#endif
