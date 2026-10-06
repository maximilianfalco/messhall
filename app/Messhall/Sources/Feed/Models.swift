import Foundation

// Hand-written from contracts/schema.json. SchemaTests fail when a field or a value drifts.

public enum Presence: String, Codable, CaseIterable, Sendable { case active, waiting, idle, gone, left }
public enum MessageKind: String, Codable, CaseIterable, Sendable { case chat, system, done, summary }
public enum MemberKind: String, Codable, CaseIterable, Sendable { case claude, codex, other, human }
public enum MemberChange: String, Codable, Sendable { case joined, left, reconnected }
public enum RoomChange: String, Codable, Sendable { case created, closed, reopened, topic }

public struct Room: Codable, Equatable, Sendable {
  public var id: String
  public var name: String
  public var topic: String?
  public var createdAt: String
  public var createdBy: String
  public var standing: Bool
  public var closedAt: String?
  public var messageCap: Int

  enum CodingKeys: String, CodingKey, CaseIterable {
    case id, name, topic, standing
    case createdAt = "created_at"
    case createdBy = "created_by"
    case closedAt = "closed_at"
    case messageCap = "message_cap"
  }
}

public struct Member: Codable, Equatable, Sendable {
  public var roomId: String
  public var name: String
  public var kind: MemberKind
  public var presence: Presence
  public var cursor: Int
  public var done: Bool
  public var joinedAt: String
  public var lastSeenAt: String
  public var leftAt: String?

  enum CodingKeys: String, CodingKey, CaseIterable {
    case name, kind, presence, cursor, done
    case roomId = "room_id"
    case joinedAt = "joined_at"
    case lastSeenAt = "last_seen_at"
    case leftAt = "left_at"
  }
}

public struct Message: Codable, Equatable, Identifiable, Sendable {
  public var id: Int
  public var roomId: String
  public var from: String
  public var kind: MessageKind
  public var text: String
  public var mentions: [String]
  public var createdAt: String

  enum CodingKeys: String, CodingKey, CaseIterable {
    case id, from, kind, text, mentions
    case roomId = "room_id"
    case createdAt = "created_at"
  }
}

public struct SnapshotRoom: Codable, Equatable, Identifiable, Sendable {
  public var id: String
  public var name: String
  public var topic: String?
  public var createdAt: String
  public var createdBy: String
  public var standing: Bool
  public var closedAt: String?
  public var messageCap: Int
  public var messageCount: Int
  public var members: [Member]
  public var messages: [Message]

  public var isOpen: Bool { closedAt == nil }

  enum CodingKeys: String, CodingKey, CaseIterable {
    case id, name, topic, standing, members, messages
    case createdAt = "created_at"
    case createdBy = "created_by"
    case closedAt = "closed_at"
    case messageCap = "message_cap"
    case messageCount = "message_count"
  }

  init(room: Room) {
    self.init(
      id: room.id, name: room.name, topic: room.topic, createdAt: room.createdAt, createdBy: room.createdBy,
      standing: room.standing, closedAt: room.closedAt, messageCap: room.messageCap, messageCount: 0, members: [],
      messages: [])
  }

  init(
    id: String, name: String, topic: String?, createdAt: String, createdBy: String, standing: Bool,
    closedAt: String?, messageCap: Int, messageCount: Int, members: [Member], messages: [Message]
  ) {
    self.id = id
    self.name = name
    self.topic = topic
    self.createdAt = createdAt
    self.createdBy = createdBy
    self.standing = standing
    self.closedAt = closedAt
    self.messageCap = messageCap
    self.messageCount = messageCount
    self.members = members
    self.messages = messages
  }
}

public struct Snapshot: Codable, Equatable, Sendable {
  public var seq: Int
  public var rooms: [SnapshotRoom]

  enum CodingKeys: String, CodingKey, CaseIterable { case seq, rooms }
}

public struct MessageEvent: Decodable, Equatable, Sendable {
  public var room: String
  public var message: Message

  enum CodingKeys: String, CodingKey, CaseIterable { case type, room, message }

  public init(room: String, message: Message) {
    self.room = room
    self.message = message
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    self.init(room: try c.decode(String.self, forKey: .room), message: try c.decode(Message.self, forKey: .message))
  }
}

public struct MemberEvent: Decodable, Equatable, Sendable {
  public var room: String
  public var change: MemberChange
  public var member: Member

  enum CodingKeys: String, CodingKey, CaseIterable { case type, room, change, member }

  public init(room: String, change: MemberChange, member: Member) {
    self.room = room
    self.change = change
    self.member = member
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      room: try c.decode(String.self, forKey: .room), change: try c.decode(MemberChange.self, forKey: .change),
      member: try c.decode(Member.self, forKey: .member))
  }
}

public struct PresenceEvent: Decodable, Equatable, Sendable {
  public var room: String
  public var name: String
  public var from: Presence
  public var to: Presence

  enum CodingKeys: String, CodingKey, CaseIterable { case type, room, name, from, to }

  public init(room: String, name: String, from: Presence, to: Presence) {
    self.room = room
    self.name = name
    self.from = from
    self.to = to
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      room: try c.decode(String.self, forKey: .room), name: try c.decode(String.self, forKey: .name),
      from: try c.decode(Presence.self, forKey: .from), to: try c.decode(Presence.self, forKey: .to))
  }
}

public struct RoomEvent: Decodable, Equatable, Sendable {
  public var change: RoomChange
  public var room: Room

  enum CodingKeys: String, CodingKey, CaseIterable { case type, change, room }

  public init(change: RoomChange, room: Room) {
    self.change = change
    self.room = room
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    self.init(change: try c.decode(RoomChange.self, forKey: .change), room: try c.decode(Room.self, forKey: .room))
  }
}

/// One change in the room store, picked by its `type` field.
public enum BusEvent: Decodable, Equatable, Sendable {
  case message(MessageEvent)
  case member(MemberEvent)
  case presence(PresenceEvent)
  case room(RoomEvent)

  private enum TypeKey: String, CodingKey { case type }

  /// The room name the event belongs to.
  public var room: String {
    switch self {
    case .message(let e): e.room
    case .member(let e): e.room
    case .presence(let e): e.room
    case .room(let e): e.room.name
    }
  }

  public var type: String {
    switch self {
    case .message: "message"
    case .member: "member"
    case .presence: "presence"
    case .room: "room"
    }
  }

  public init(from decoder: Decoder) throws {
    let type = try decoder.container(keyedBy: TypeKey.self).decode(String.self, forKey: .type)
    switch type {
    case "message": self = .message(try MessageEvent(from: decoder))
    case "member": self = .member(try MemberEvent(from: decoder))
    case "presence": self = .presence(try PresenceEvent(from: decoder))
    case "room": self = .room(try RoomEvent(from: decoder))
    default:
      throw DecodingError.dataCorrupted(.init(codingPath: [TypeKey.type], debugDescription: "unknown type \(type)"))
    }
  }
}

public struct HumanPost: Codable, Equatable, Sendable {
  public var text: String

  enum CodingKeys: String, CodingKey, CaseIterable { case text }
}

public struct HumanPostResult: Codable, Equatable, Sendable {
  public var message: Message

  enum CodingKeys: String, CodingKey, CaseIterable { case message }
}

public struct FeedError: Codable, Equatable, Sendable {
  public var error: String

  enum CodingKeys: String, CodingKey, CaseIterable { case error }
}
