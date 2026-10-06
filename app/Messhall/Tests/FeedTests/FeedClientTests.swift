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

  @Test("the snapshot is a plain keyed GET")
  func snapshot() throws {
    let request = try client(key: "k1").request(.snapshot)

    #expect(request.httpMethod == "GET")
    #expect(request.url?.path == "/api/snapshot")
    #expect(request.value(forHTTPHeaderField: "last-event-id") == nil)
  }

  @Test("a missing key file says to start the daemon")
  func missingKey() throws {
    #expect(throws: FeedClient.KeyMissing.self) { try client(key: nil).request(.snapshot) }
  }
}
