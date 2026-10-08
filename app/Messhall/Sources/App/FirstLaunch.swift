import AppKit
import Feed

/// On the first launch of an installed app (and after each upgrade) puts the daemon and the `messhall` command in place.
/// A build with no bundled runtime, like `make app`, does nothing.
@MainActor
enum FirstLaunch {
  private static let offeredMcpKey = "offeredMcpInstall"

  static func run() async {
    let installer = RuntimeInstaller(bundled: Bundle.main.url(forResource: "runtime", withExtension: nil), run: Self.spawn)
    let version = Self.version
    guard installer.needsInstall(version: version) else { return }
    do {
      try await installer.install(version: version)
    } catch {
      alert("Messhall could not start its daemon", "Run messhall install in a terminal to see why. \(error)")
      return
    }
    await offerMcp(installer)
  }

  private static var version: String {
    let info = Bundle.main.infoDictionary ?? [:]
    let short = info["CFBundleShortVersionString"] as? String ?? "0"
    return "\(short)-\(info["MesshallCommit"] as? String ?? "")"
  }

  private static func offerMcp(_ installer: RuntimeInstaller) async {
    guard !UserDefaults.standard.bool(forKey: offeredMcpKey) else { return }
    UserDefaults.standard.set(true, forKey: offeredMcpKey)
    let ask = NSAlert()
    ask.messageText = "Add Messhall to your agents?"
    ask.informativeText = "This runs messhall mcp install, so Claude Code, Codex and Gemini CLI can join rooms."
    ask.addButton(withTitle: "Add")
    ask.addButton(withTitle: "Not now")
    guard ask.runModal() == .alertFirstButtonReturn else { return }
    do {
      try await installer.installMcp()
    } catch {
      alert("Could not add Messhall to your agents", "Run messhall mcp install in a terminal. \(error)")
    }
  }

  private static func alert(_ title: String, _ detail: String) {
    let alert = NSAlert()
    alert.messageText = title
    alert.informativeText = detail
    alert.runModal()
  }

  @Sendable
  private static func spawn(_ program: URL, _ arguments: [String]) async throws -> Int32 {
    try await withCheckedThrowingContinuation { continuation in
      let process = Process()
      process.executableURL = program
      process.arguments = arguments
      process.terminationHandler = { continuation.resume(returning: $0.terminationStatus) }
      do { try process.run() } catch { continuation.resume(throwing: error) }
    }
  }
}
