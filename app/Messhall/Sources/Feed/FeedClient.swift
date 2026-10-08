import Foundation

/// Builds keyed requests for the daemon's feed routes.
public struct FeedClient: Sendable {
  public enum Route: Sendable {
    case snapshot
    case history(room: String, before: Int, limit: Int)
    case events(after: Int)
    case post(room: String, text: String)
    case newRoom(NewRoom)
    case close(room: String)
    case reopen(room: String)
    case role(room: String, member: String, role: String)
    case remove(room: String, member: String)
    case mute(room: String, member: String, muted: Bool)
    case spawn(room: String, seat: HumanSpawn)
    case answer(approval: String, allow: Bool)
    case pick(question: String, option: Int)
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
    case .history(let room, let before, let limit):
      let page = [URLQueryItem(name: "before", value: String(before)), URLQueryItem(name: "limit", value: String(limit))]
      request = URLRequest(
        url: config.baseURL.appendingPathComponent("api/rooms/\(room)/messages").appending(queryItems: page))
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
    case .role(let room, let member, let role):
      request = URLRequest(url: config.baseURL.appendingPathComponent("api/rooms/\(room)/members/\(member)/role"))
      request.httpMethod = "POST"
      request.setValue("application/json", forHTTPHeaderField: "content-type")
      request.httpBody = try JSONEncoder().encode(HumanRole(role: role))
    case .remove(let room, let member):
      request = URLRequest(url: config.baseURL.appendingPathComponent("api/rooms/\(room)/members/\(member)"))
      request.httpMethod = "DELETE"
    case .mute(let room, let member, let muted):
      let action = muted ? "mute" : "unmute"
      request = URLRequest(url: config.baseURL.appendingPathComponent("api/rooms/\(room)/members/\(member)/\(action)"))
      request.httpMethod = "POST"
    case .spawn(let room, let seat):
      request = URLRequest(url: config.baseURL.appendingPathComponent("api/rooms/\(room)/spawn"))
      request.httpMethod = "POST"
      request.setValue("application/json", forHTTPHeaderField: "content-type")
      request.httpBody = try JSONEncoder().encode(seat)
    case .answer(let approval, let allow):
      request = URLRequest(url: config.baseURL.appendingPathComponent("api/approvals/\(approval)"))
      request.httpMethod = "POST"
      request.setValue("application/json", forHTTPHeaderField: "content-type")
      request.httpBody = try JSONEncoder().encode(HumanApproval(behavior: allow ? "allow" : "deny"))
    case .pick(let question, let option):
      request = URLRequest(url: config.baseURL.appendingPathComponent("api/questions/\(question)"))
      request.httpMethod = "POST"
      request.setValue("application/json", forHTTPHeaderField: "content-type")
      request.httpBody = try JSONEncoder().encode(HumanAnswer(option: option))
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
