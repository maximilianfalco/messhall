import Foundation
import Testing

@testable import Feed

private struct Definition: Decodable {
  let properties: [String: JSONValue]?
  let `enum`: [String]?
}

private struct JSONValue: Decodable {
  let current: Int?
  enum CodingKeys: String, CodingKey { case current = "x-current" }
}

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
  "Approval": Approval.CodingKeys.allCases.map(\.rawValue),
  "ApprovalEvent": ApprovalEvent.CodingKeys.allCases.map(\.rawValue),
  "ApprovalResult": ApprovalResult.CodingKeys.allCases.map(\.rawValue),
  "HumanApproval": HumanApproval.CodingKeys.allCases.map(\.rawValue),
  "Agreement": Agreement.CodingKeys.allCases.map(\.rawValue),
  "AgreementEvent": AgreementEvent.CodingKeys.allCases.map(\.rawValue),
  "AnswerResult": AnswerResult.CodingKeys.allCases.map(\.rawValue),
  "HumanAnswer": HumanAnswer.CodingKeys.allCases.map(\.rawValue),
  "Question": Question.CodingKeys.allCases.map(\.rawValue),
  "QuestionEvent": QuestionEvent.CodingKeys.allCases.map(\.rawValue),
  "FeedError": FeedError.CodingKeys.allCases.map(\.rawValue),
  "History": History.CodingKeys.allCases.map(\.rawValue),
  "HumanPost": HumanPost.CodingKeys.allCases.map(\.rawValue),
  "HumanPostResult": HumanPostResult.CodingKeys.allCases.map(\.rawValue),
  "HumanRole": HumanRole.CodingKeys.allCases.map(\.rawValue),
  "HumanRoleResult": HumanRoleResult.CodingKeys.allCases.map(\.rawValue),
  "CloseResult": RoomResult.CodingKeys.allCases.map(\.rawValue),
  "Member": Member.CodingKeys.allCases.map(\.rawValue),
  "MemberEvent": MemberEvent.CodingKeys.allCases.map(\.rawValue),
  "MuteResult": MuteResult.CodingKeys.allCases.map(\.rawValue),
  "Message": Message.CodingKeys.allCases.map(\.rawValue),
  "MessageEvent": MessageEvent.CodingKeys.allCases.map(\.rawValue),
  "NewRoom": NewRoom.CodingKeys.allCases.map(\.rawValue),
  "NewRoomResult": RoomResult.CodingKeys.allCases.map(\.rawValue),
  "PresenceEvent": PresenceEvent.CodingKeys.allCases.map(\.rawValue),
  "RemoveMemberResult": RemoveMemberResult.CodingKeys.allCases.map(\.rawValue),
  "ReopenResult": RoomResult.CodingKeys.allCases.map(\.rawValue),
  "Room": Room.CodingKeys.allCases.map(\.rawValue),
  "RoomEvent": RoomEvent.CodingKeys.allCases.map(\.rawValue),
  "Snapshot": Snapshot.CodingKeys.allCases.map(\.rawValue),
  "SnapshotRoom": SnapshotRoom.CodingKeys.allCases.map(\.rawValue),
]

private let enums: [String: [String]] = [
  "MemberKind": MemberKind.allCases.filter { $0 != .unknown }.map(\.rawValue),
  "MessageKind": MessageKind.allCases.filter { $0 != .unknown }.map(\.rawValue),
  "Presence": Presence.allCases.filter { $0 != .unknown }.map(\.rawValue),
]

private let unused: Set = [
  "BusEvent", "Health", "RoomSummary", "SearchHit", "SearchResult", "SequencedEvent",
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

  @Test("the app's feed contract is the schema's current one")
  func contract() throws {
    let field = try #require(schema.defs["Snapshot"]?.properties?["contract_version"])

    #expect(field.current == FeedContract.version)
  }
}
