import Foundation
import Testing

@testable import Feed

@Suite("FeedClient")
struct FeedClientTests {
  private func client(key: String?) throws -> FeedClient {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    if let key { try "\(key)\n".write(to: dir.appendingPathComponent("human-key"), atomically: true, encoding: .utf8) }
    return FeedClient(config: FeedConfig(environment: ["MESSHALL_HOME": dir.path, "MESSHALL_PORT": "7796"]))
  }

  @Test("the human post carries the key, the room path and the text")
  func humanPost() throws {
    let request = try client(key: "k1").request(.post(room: "checkout", text: "ship it"))

    #expect(request.httpMethod == "POST")
    #expect(request.url?.absoluteString == "http://127.0.0.1:7796/api/rooms/checkout/messages")
    #expect(request.value(forHTTPHeaderField: "x-messhall-key") == "k1")
    #expect(request.value(forHTTPHeaderField: "content-type") == "application/json")
    #expect(request.httpBody == Data(#"{"text":"ship it"}"#.utf8))
  }

  @Test("the event stream resumes from the last sequence")
  func events() throws {
    let request = try client(key: "k1").request(.events(after: 42))

    #expect(request.url?.path == "/api/events")
    #expect(request.value(forHTTPHeaderField: "last-event-id") == "42")
    #expect(request.value(forHTTPHeaderField: "accept") == "text/event-stream")
  }

  @Test("an older page asks for the messages below an id, with a limit")
  func history() throws {
    let request = try client(key: "k1").request(.history(room: "checkout", before: 51, limit: 100))

    #expect(request.httpMethod == "GET")
    #expect(request.url?.absoluteString == "http://127.0.0.1:7796/api/rooms/checkout/messages?before=51&limit=100")
    #expect(request.value(forHTTPHeaderField: "x-messhall-key") == "k1")
  }

  @Test("the snapshot is a plain keyed GET")
  func snapshot() throws {
    let request = try client(key: "k1").request(.snapshot)

    #expect(request.httpMethod == "GET")
    #expect(request.url?.path == "/api/snapshot")
    #expect(request.value(forHTTPHeaderField: "last-event-id") == nil)
  }

  @Test("a new room posts the name, topic and cap to the rooms route")
  func newRoom() throws {
    let request = try client(key: "k1").request(.newRoom(NewRoom(name: "release-notes", topic: "v2 notes", cap: 120)))
    let body = try JSONDecoder().decode([String: JSONScalar].self, from: try #require(request.httpBody))

    #expect(request.httpMethod == "POST")
    #expect(request.url?.absoluteString == "http://127.0.0.1:7796/api/rooms")
    #expect(request.value(forHTTPHeaderField: "x-messhall-key") == "k1")
    #expect(body == ["name": .text("release-notes"), "topic": .text("v2 notes"), "cap": .number(120)])
  }

  @Test("a new room with no topic leaves the field out")
  func newRoomNoTopic() throws {
    let request = try client(key: "k1").request(.newRoom(NewRoom(name: "ops", topic: nil, cap: 200)))
    let body = try JSONDecoder().decode([String: JSONScalar].self, from: try #require(request.httpBody))

    #expect(body == ["name": .text("ops"), "cap": .number(200)])
  }

  @Test("close and reopen post to the room's action path", arguments: [
    (FeedClient.Route.close(room: "ops"), "/api/rooms/ops/close"),
    (FeedClient.Route.reopen(room: "ops"), "/api/rooms/ops/reopen"),
  ])
  func roomAction(route: FeedClient.Route, path: String) throws {
    let request = try client(key: "k1").request(route)

    #expect(request.httpMethod == "POST")
    #expect(request.url?.path == path)
    #expect(request.value(forHTTPHeaderField: "x-messhall-key") == "k1")
  }

  @Test("a missing key file says to start the daemon")
  func missingKey() throws {
    #expect(throws: FeedClient.KeyMissing.self) { try client(key: nil).request(.snapshot) }
  }
}

private enum JSONScalar: Decodable, Equatable {
  case text(String)
  case number(Int)

  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if let n = try? c.decode(Int.self) { self = .number(n) } else { self = .text(try c.decode(String.self)) }
  }
}
