import Foundation

/// Copies the node and CLI the .dmg carries to a stable folder, puts `messhall` on the PATH and loads the daemon.
/// The LaunchAgent points into the copy, so moving or deleting the app never breaks the daemon.
public struct RuntimeInstaller: Sendable {
  public struct Failure: Error, Equatable {
    public let output: String
  }

  public typealias Run = @Sendable (_ program: URL, _ arguments: [String]) async throws -> Int32

  private let bundled: URL?
  private let home: URL
  private let run: Run

  public init(bundled: URL?, home: URL = FileManager.default.homeDirectoryForCurrentUser, run: @escaping Run) {
    self.bundled = bundled
    self.home = home
    self.run = run
  }

  public var runtimeDir: URL {
    home.appendingPathComponent("Library/Application Support/messhall/runtime")
  }

  public var commandPath: URL {
    home.appendingPathComponent(".local/bin/messhall")
  }

  private var marker: URL { runtimeDir.appendingPathComponent("VERSION") }

  public func needsInstall(version: String) -> Bool {
    guard bundled != nil else { return false }
    return (try? String(contentsOf: marker, encoding: .utf8)) != version
  }

  public func install(version: String) async throws {
    guard let bundled else { return }
    let files = FileManager.default
    try? files.removeItem(at: runtimeDir)
    try files.createDirectory(at: runtimeDir.deletingLastPathComponent(), withIntermediateDirectories: true)
    try files.copyItem(at: bundled, to: runtimeDir)

    let node = runtimeDir.appendingPathComponent("node")
    let cli = runtimeDir.appendingPathComponent("cli/dist/src/cli.js")
    try files.createDirectory(at: commandPath.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? files.removeItem(at: commandPath)
    let script = "#!/bin/sh\nexec \"\(node.path)\" --disable-warning=ExperimentalWarning \"\(cli.path)\" \"$@\"\n"
    try script.write(to: commandPath, atomically: true, encoding: .utf8)
    try files.setAttributes([.posixPermissions: 0o755], ofItemAtPath: commandPath.path)

    let code = try await run(node, ["--disable-warning=ExperimentalWarning", cli.path, "install"])
    guard code == 0 else { throw Failure(output: "messhall install exited \(code)") }
    try version.write(to: marker, atomically: true, encoding: .utf8)
  }

  /// Runs `messhall mcp install --yes` so Claude Code, Codex and Gemini find the room.
  public func installMcp() async throws {
    let code = try await run(commandPath, ["mcp", "install", "--yes"])
    guard code == 0 else { throw Failure(output: "messhall mcp install exited \(code)") }
  }
}
