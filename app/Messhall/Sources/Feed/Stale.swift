import Foundation

extension Build {
  /// This app's own stamp, written into its Info.plist by bundle.sh. Nil in a test or a plain swift build.
  public static let app: Build? = {
    let info = Bundle.main.infoDictionary
    guard let commit = info?["MesshallCommit"] as? String, let at = info?["MesshallCommittedAt"] as? String else {
      return nil
    }
    return Build(commit: commit, committedAt: at)
  }()

  /// Both sides send millis today. Plain seconds parse too, so a hand-written stamp still compares.
  var date: Date? {
    (try? Date(committedAt, strategy: .iso8601))
      ?? (try? Date(committedAt, strategy: .iso8601.time(includingFractionalSeconds: true)))
  }
}

/// Which side runs older code, so the notice names the right fix.
public enum StaleSide: Equatable, Sendable {
  case daemon, app

  public var reason: String {
    switch self {
    case .daemon: "The daemon is older than this app. Run messhall start."
    case .app: "This app is older than the daemon. Run make app."
    }
  }

  /// The contract decides. On a tie the commit time does, and a daemon with no stamp predates stamps.
  static func of(contract: Int?, build: Build?, appContract: Int, appBuild: Build?) -> StaleSide {
    let contract = contract ?? 0
    if contract != appContract { return contract < appContract ? .daemon : .app }
    guard let daemon = build?.date, let app = appBuild?.date else { return .daemon }
    return daemon > app ? .app : .daemon
  }
}

/// A snapshot the app cannot decode, with the two fields that still say which side is older.
struct UnreadableSnapshot: Error {
  var contractVersion: Int?
  var build: Build?
}

private struct VersionProbe: Decodable {
  var contractVersion: Int?
  var build: Build?

  enum CodingKeys: String, CodingKey {
    case build
    case contractVersion = "contract_version"
  }
}

extension SnapshotLoader {
  /// Decodes a snapshot. When that fails it reads only the version fields, so the notice can blame the right side.
  static func read(_ data: Data) throws -> Snapshot {
    do {
      return try JSONDecoder().decode(Snapshot.self, from: data)
    } catch is DecodingError {
      let probe = try? JSONDecoder().decode(VersionProbe.self, from: data)
      throw UnreadableSnapshot(contractVersion: probe?.contractVersion, build: probe?.build)
    }
  }
}
