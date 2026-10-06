import Foundation

/// Builds keyed requests for the daemon's feed routes.
public struct FeedClient: Sendable {
  public enum Route: Sendable {
    case snapshot
    case events(after: Int)
    case post(room: String, text: String)
    case newRoom(NewRoom)
    case close(room: String)
    case reopen(room: String)
  }

  public struct KeyMissing: Error {}

  /// A non-2xx answer, with the daemon's own error text when it sent one.
  public struct Refused: Error {
    public let status: Int
    public let message: String
  }

  // Three missed pings and the stream counts as dead, so it reconnects.
  static let streamTimeout: TimeInterval = 45

  public let config: FeedConfig
  let session: URLSession

  public init(config: FeedConfig = FeedConfig(), session: URLSession = .shared) {
    self.config = config
    self.session = session
  }

  func request(_ route: Route) throws -> URLRequest {
    var request: URLRequest
    switch route {
    case .snapshot:
      request = URLRequest(url: config.baseURL.appendingPathComponent("api/snapshot"))
    case .events(let after):
      request = URLRequest(url: config.baseURL.appendingPathComponent("api/events"), timeoutInterval: Self.streamTimeout)
      request.setValue("text/event-stream", forHTTPHeaderField: "accept")
      request.setValue(String(after), forHTTPHeaderField: "last-event-id")
    case .post(let room, let text):
      request = URLRequest(url: config.baseURL.appendingPathComponent("api/rooms/\(room)/messages"))
      request.httpMethod = "POST"
      request.setValue("application/json", forHTTPHeaderField: "content-type")
      request.httpBody = try JSONEncoder().encode(HumanPost(text: text))
    case .newRoom(let room):
      request = URLRequest(url: config.baseURL.appendingPathComponent("api/rooms"))
      request.httpMethod = "POST"
      request.setValue("application/json", forHTTPHeaderField: "content-type")
      request.httpBody = try JSONEncoder().encode(room)
    case .close(let room):
      request = URLRequest(url: config.baseURL.appendingPathComponent("api/rooms/\(room)/close"))
      request.httpMethod = "POST"
    case .reopen(let room):
      request = URLRequest(url: config.baseURL.appendingPathComponent("api/rooms/\(room)/reopen"))
      request.httpMethod = "POST"
    }
    request.setValue(try humanKey(), forHTTPHeaderField: "x-messhall-key")
    return request
  }

  private func humanKey() throws -> String {
    let key = (try? String(contentsOf: config.humanKeyFile, encoding: .utf8))?
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard let key, !key.isEmpty else { throw KeyMissing() }
    return key
  }

  func check(_ response: URLResponse, _ body: Data = Data()) throws {
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard !(200..<300).contains(status) else { return }
    let message = (try? JSONDecoder().decode(FeedError.self, from: body))?.error ?? "status \(status)"
    throw Refused(status: status, message: message)
  }
}
