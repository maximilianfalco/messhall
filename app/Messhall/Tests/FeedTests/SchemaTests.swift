import Foundation
import Testing

@testable import Feed

private struct Definition: Decodable {
  let properties: [String: JSONValue]?
  let `enum`: [String]?
}

private struct JSONValue: Decodable {}

private struct SchemaFile: Decodable {
  let defs: [String: Definition]
  enum CodingKeys: String, CodingKey { case defs = "$defs" }
}

private let schema: SchemaFile = {
  let url = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().appendingPathComponent("../../../../contracts/schema.json").standardized
  return try! JSONDecoder().decode(SchemaFile.self, from: Data(contentsOf: url))
}()

private let models: [String: [String]] = [
  "FeedError": FeedError.CodingKeys.allCases.map(\.rawValue),
  "HumanPost": HumanPost.CodingKeys.allCases.map(\.rawValue),
  "HumanPostResult": HumanPostResult.CodingKeys.allCases.map(\.rawValue),
  "CloseResult": RoomResult.CodingKeys.allCases.map(\.rawValue),
  "Member": Member.CodingKeys.allCases.map(\.rawValue),
  "MemberEvent": MemberEvent.CodingKeys.allCases.map(\.rawValue),
  "Message": Message.CodingKeys.allCases.map(\.rawValue),
  "MessageEvent": MessageEvent.CodingKeys.allCases.map(\.rawValue),
  "NewRoom": NewRoom.CodingKeys.allCases.map(\.rawValue),
  "NewRoomResult": RoomResult.CodingKeys.allCases.map(\.rawValue),
  "PresenceEvent": PresenceEvent.CodingKeys.allCases.map(\.rawValue),
  "ReopenResult": RoomResult.CodingKeys.allCases.map(\.rawValue),
  "Room": Room.CodingKeys.allCases.map(\.rawValue),
  "RoomEvent": RoomEvent.CodingKeys.allCases.map(\.rawValue),
  "Snapshot": Snapshot.CodingKeys.allCases.map(\.rawValue),
  "SnapshotRoom": SnapshotRoom.CodingKeys.allCases.map(\.rawValue),
]

private let enums: [String: [String]] = [
  "MemberKind": MemberKind.allCases.map(\.rawValue),
  "MessageKind": MessageKind.allCases.map(\.rawValue),
  "Presence": Presence.allCases.map(\.rawValue),
]

private let unused: Set = [
  "BusEvent", "Health", "History", "RoomSummary", "SearchHit", "SearchResult", "SequencedEvent",
]

@Suite("contracts/schema.json")
struct SchemaTests {
  @Test("every definition has a Swift model or is listed as unused")
  func everyDefinition() {
    let covered = Set(models.keys).union(enums.keys).union(unused)

    #expect(Set(schema.defs.keys).subtracting(covered).sorted() == [])
  }

  @Test("each model has exactly the schema's fields", arguments: models.keys.sorted())
  func fields(name: String) throws {
    let definition = try #require(schema.defs[name])

    #expect(Set(models[name]!) == Set(definition.properties?.keys ?? [:].keys))
  }

  @Test("each enum has exactly the schema's values", arguments: enums.keys.sorted())
  func values(name: String) throws {
    let definition = try #require(schema.defs[name])

    #expect(enums[name]! == definition.enum)
  }
}
