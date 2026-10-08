import Foundation
import Testing

@testable import Feed

@Suite("RuntimeInstaller")
struct RuntimeInstallerTests {
  private func scratch() throws -> URL {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("runtime-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  private func bundled(in root: URL) throws -> URL {
    let runtime = root.appendingPathComponent("bundle-runtime")
    try FileManager.default.createDirectory(at: runtime.appendingPathComponent("cli/dist/src"), withIntermediateDirectories: true)
    try Data().write(to: runtime.appendingPathComponent("node"))
    try Data("cli".utf8).write(to: runtime.appendingPathComponent("cli/dist/src/cli.js"))
    return runtime
  }

  private final class Calls: @unchecked Sendable {
    var lines: [String] = []
  }

  private func installer(home: URL, bundled: URL?, calls: Calls, exit: Int32 = 0) -> RuntimeInstaller {
    RuntimeInstaller(bundled: bundled, home: home) { program, arguments in
      calls.lines.append(([program.lastPathComponent] + arguments).joined(separator: " "))
      return exit
    }
  }

  @Test("an install copies the runtime, links the command and loads the daemon")
  func installs() async throws {
    let home = try scratch()
    let calls = Calls()
    let installer = installer(home: home, bundled: try bundled(in: home), calls: calls)
    try await installer.install(version: "1")

    let runtime = installer.runtimeDir
    #expect(FileManager.default.fileExists(atPath: runtime.appendingPathComponent("cli/dist/src/cli.js").path))
    #expect(FileManager.default.isExecutableFile(atPath: installer.commandPath.path))
    let wrapper = try String(contentsOf: installer.commandPath, encoding: .utf8)
    #expect(wrapper.contains(runtime.appendingPathComponent("node").path))
    #expect(calls.lines.count == 1)
    #expect(calls.lines[0] == "node --disable-warning=ExperimentalWarning \(runtime.path)/cli/dist/src/cli.js install")
  }

  @Test("a matching version needs no install, a new one does")
  func needsInstall() async throws {
    let home = try scratch()
    let installer = installer(home: home, bundled: try bundled(in: home), calls: Calls())
    #expect(installer.needsInstall(version: "1"))
    try await installer.install(version: "1")
    #expect(!installer.needsInstall(version: "1"))
    #expect(installer.needsInstall(version: "2"))
  }

  @Test("an app with no bundled runtime never installs")
  func noRuntime() async throws {
    let home = try scratch()
    #expect(!installer(home: home, bundled: nil, calls: Calls()).needsInstall(version: "1"))
  }

  @Test("a failed daemon load throws and leaves the version unmarked, so the next launch retries")
  func failedLoad() async throws {
    let home = try scratch()
    let installer = installer(home: home, bundled: try bundled(in: home), calls: Calls(), exit: 1)
    await #expect(throws: RuntimeInstaller.Failure.self) { try await installer.install(version: "1") }
    #expect(installer.needsInstall(version: "1"))
  }

  @Test("an upgrade replaces the old runtime files")
  func upgrade() async throws {
    let home = try scratch()
    let source = try bundled(in: home)
    let installer = installer(home: home, bundled: source, calls: Calls())
    try await installer.install(version: "1")
    try Data().write(to: installer.runtimeDir.appendingPathComponent("cli/stale.js"))
    try await installer.install(version: "2")
    #expect(!FileManager.default.fileExists(atPath: installer.runtimeDir.appendingPathComponent("cli/stale.js").path))
  }
}
