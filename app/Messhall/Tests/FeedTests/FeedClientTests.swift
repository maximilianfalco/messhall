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

  @Test("a new room posts the name and topic to the rooms route")
  func newRoom() throws {
    let request = try client(key: "k1").request(.newRoom(NewRoom(name: "release-notes", topic: "v2 notes")))
    let body = try JSONDecoder().decode([String: String].self, from: try #require(request.httpBody))

    #expect(request.httpMethod == "POST")
    #expect(request.url?.absoluteString == "http://127.0.0.1:7796/api/rooms")
    #expect(request.value(forHTTPHeaderField: "x-messhall-key") == "k1")
    #expect(body == ["name": "release-notes", "topic": "v2 notes"])
  }

  @Test("a new room with no topic leaves the field out")
  func newRoomNoTopic() throws {
    let request = try client(key: "k1").request(.newRoom(NewRoom(name: "ops", topic: nil)))
    let body = try JSONDecoder().decode([String: String].self, from: try #require(request.httpBody))

    #expect(body == ["name": "ops"])
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

  @Test("a mute and an unmute post with no body to the member's mute paths")
  func mute() throws {
    let mute = try client(key: "k1").request(.mute(room: "ops", member: "api", muted: true))
    let unmute = try client(key: "k1").request(.mute(room: "ops", member: "api", muted: false))

    #expect(mute.httpMethod == "POST")
    #expect(mute.httpBody == nil)
    #expect(mute.url?.absoluteString == "http://127.0.0.1:7796/api/rooms/ops/members/api/mute")
    #expect(unmute.url?.absoluteString == "http://127.0.0.1:7796/api/rooms/ops/members/api/unmute")
    #expect(mute.value(forHTTPHeaderField: "x-messhall-key") == "k1")
  }

  @Test("an answer posts allow or deny to the approval's own path", arguments: [
    (true, "allow"), (false, "deny"),
  ])
  func answer(allow: Bool, behavior: String) throws {
    let request = try client(key: "k1").request(.answer(approval: "4b0c6a52-0d7e-4b8e-9c55-0f6a1e2b3c4d", allow: allow))

    #expect(request.httpMethod == "POST")
    #expect(
      request.url?.absoluteString == "http://127.0.0.1:7796/api/approvals/4b0c6a52-0d7e-4b8e-9c55-0f6a1e2b3c4d")
    #expect(request.httpBody == Data("{\"behavior\":\"\(behavior)\"}".utf8))
    #expect(request.value(forHTTPHeaderField: "x-messhall-key") == "k1")
  }

  @Test("a pick posts one answer per question to the question's own path, typed text only when there is some")
  func pick() throws {
    let answers = [QuestionAnswer(picks: [2]), QuestionAnswer(picks: [], other: "after lunch")]
    let request = try client(key: "k1").request(
      .pick(question: "7e2a9c41-3b5d-4f60-a8e1-5c4d2b1f0a93", answers: answers))

    #expect(request.httpMethod == "POST")
    #expect(
      request.url?.absoluteString == "http://127.0.0.1:7796/api/questions/7e2a9c41-3b5d-4f60-a8e1-5c4d2b1f0a93")
    #expect(request.value(forHTTPHeaderField: "content-type") == "application/json")
    let body = try JSONDecoder().decode(HumanAnswer.self, from: try #require(request.httpBody))
    #expect(body.answers == answers)
    #expect(!String(decoding: try #require(request.httpBody), as: UTF8.self).contains("null"))
    #expect(request.value(forHTTPHeaderField: "x-messhall-key") == "k1")
  }

  @Test("a role posts just the role to the member's role path")
  func role() throws {
    let request = try client(key: "k1").request(.role(room: "ops", member: "api", role: "reviewer"))

    #expect(request.httpMethod == "POST")
    #expect(request.url?.absoluteString == "http://127.0.0.1:7796/api/rooms/ops/members/api/role")
    #expect(request.value(forHTTPHeaderField: "x-messhall-key") == "k1")
    #expect(request.value(forHTTPHeaderField: "content-type") == "application/json")
    #expect(request.httpBody == Data(#"{"role":"reviewer"}"#.utf8))
  }

  @Test("a remove deletes the member's path")
  func remove() throws {
    let request = try client(key: "k1").request(.remove(room: "ops", member: "api"))

    #expect(request.httpMethod == "DELETE")
    #expect(request.url?.absoluteString == "http://127.0.0.1:7796/api/rooms/ops/members/api")
    #expect(request.value(forHTTPHeaderField: "x-messhall-key") == "k1")
  }

  @Test("a missing key file says to start the daemon")
  func missingKey() throws {
    #expect(throws: FeedClient.KeyMissing.self) { try client(key: nil).request(.snapshot) }
  }
}

@Suite("FeedClient spawn")
struct FeedClientSpawnTests {
  @Test("a spawn posts the seat to the room's spawn path with the human key")
  func spawn() throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    try "k1\n".write(to: dir.appendingPathComponent("human-key"), atomically: true, encoding: .utf8)
    let client = FeedClient(config: FeedConfig(environment: ["MESSHALL_HOME": dir.path, "MESSHALL_PORT": "7796"]))
    let seat = HumanSpawn(name: "worker", role: "worker", cwd: "/tmp", instructions: "do it", model: nil, agent: .codex)

    let request = try client.request(.spawn(room: "review", seat: seat))
    let body = try JSONDecoder().decode([String: String].self, from: try #require(request.httpBody))

    #expect(request.httpMethod == "POST")
    #expect(request.url?.path == "/api/rooms/review/spawn")
    #expect(request.value(forHTTPHeaderField: "x-messhall-key") == "k1")
    #expect(body == ["name": "worker", "role": "worker", "cwd": "/tmp", "instructions": "do it", "agent": "codex"])
    #expect(request.timeoutInterval > 120)
  }

  @Test("the flock asks for one room's spawned seats with the human key")
  func flock() throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    try "k1\n".write(to: dir.appendingPathComponent("human-key"), atomically: true, encoding: .utf8)
    let client = FeedClient(config: FeedConfig(environment: ["MESSHALL_HOME": dir.path, "MESSHALL_PORT": "7796"]))

    let request = try client.request(.flock(room: "review"))

    #expect(request.httpMethod == "GET")
    #expect(request.url?.absoluteString == "http://127.0.0.1:7796/api/flock?room=review")
    #expect(request.value(forHTTPHeaderField: "x-messhall-key") == "k1")
  }

  @Test("the running list asks with the human key")
  func running() throws {
    let client = try keyedClient()

    let request = try client.request(.running)

    #expect(request.httpMethod == "GET")
    #expect(request.url?.absoluteString == "http://127.0.0.1:7796/api/running")
    #expect(request.value(forHTTPHeaderField: "x-messhall-key") == "k1")
  }

  @Test("an invite posts the picked ids and the room with the human key")
  func inviteRunning() throws {
    let client = try keyedClient()

    let request = try client.request(.inviteRunning(RunningInvite(ids: ["s-1", "t-1"], room: "rm-7")))

    #expect(request.httpMethod == "POST")
    #expect(request.url?.absoluteString == "http://127.0.0.1:7796/api/running/invite")
    #expect(request.value(forHTTPHeaderField: "x-messhall-key") == "k1")
    let body = try JSONDecoder().decode(RunningInvite.self, from: try #require(request.httpBody))
    #expect(body == RunningInvite(ids: ["s-1", "t-1"], room: "rm-7"))
  }

  private func keyedClient() throws -> FeedClient {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    try "k1\n".write(to: dir.appendingPathComponent("human-key"), atomically: true, encoding: .utf8)
    return FeedClient(config: FeedConfig(environment: ["MESSHALL_HOME": dir.path, "MESSHALL_PORT": "7796"]))
  }
}
