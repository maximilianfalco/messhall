import Foundation

/// Where the daemon listens and where its human key lives, same rules as the CLI.
public struct FeedConfig: Sendable {
  public static let defaultPort = 7707

  public let baseURL: URL
  public let humanKeyFile: URL

  public init(environment: [String: String] = ProcessInfo.processInfo.environment, home: URL = FileManager.default.homeDirectoryForCurrentUser) {
    let port = environment["MESSHALL_PORT"].flatMap(Int.init).flatMap { (0...65_535).contains($0) ? $0 : nil }
    baseURL = URL(string: "http://127.0.0.1:\(port ?? Self.defaultPort)")!
    let dataDir =
      environment["MESSHALL_HOME"].flatMap { $0.isEmpty ? nil : URL(fileURLWithPath: $0) }
      ?? home.appendingPathComponent("Library/Application Support/messhall")
    humanKeyFile = dataDir.appendingPathComponent("human-key")
  }
}
