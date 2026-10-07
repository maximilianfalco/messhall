import Foundation

// Hand-written from contracts/schema.json. SchemaTests fail when a field or a value drifts.

/// The feed contract this app was built against. A newer daemon sends a higher one.
public enum FeedContract {
  public static let version = 4
}

/// A feed enum that grows over time. A value this build does not know decodes as `unknown`, so the stream stays up.
public protocol OpenEnum: RawRepresentable, Codable where RawValue == String {
  static var unknown: Self { get }
}

extension OpenEnum {
  public init(from decoder: Decoder) throws {
    self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
  }
}

public enum Presence: String, OpenEnum, CaseIterable, Sendable {
  case invited, active, waiting, idle, away, left, unknown

  public var isAway: Bool { self == .away || self == .left }
}
public enum MessageKind: String, OpenEnum, CaseIterable, Sendable { case chat, system, done, summary, unknown }
public enum MemberKind: String, OpenEnum, CaseIterable, Sendable { case claude, codex, other, human, unknown }
public enum MemberChange: String, OpenEnum, Sendable {
  case invited, joined, left, muted, reconnected, removed, role, status, unmuted, unknown
}
public enum RoomChange: String, OpenEnum, Sendable { case created, closed, reopened, topic, unknown }
public enum ApprovalState: String, OpenEnum, CaseIterable, Sendable { case pending, allowed, denied, expired, unknown }

/// An agent's tool ask, waiting for the human or answered. `description` and `inputPreview` are the agent's own text.
public struct Approval: Codable, Equatable, Identifiable, Sendable {
  public var id: String
  public var room: String
  public var member: String
  public var tool: String
  public var description: String
  public var inputPreview: String
  public var state: ApprovalState
  public var createdAt: String
  public var answeredAt: String?

  enum CodingKeys: String, CodingKey, CaseIterable {
    case id, room, member, tool, description, state
    case inputPreview = "input_preview"
    case createdAt = "created_at"
    case answeredAt = "answered_at"
  }
}

public enum QuestionState: String, OpenEnum, CaseIterable, Sendable {
  case open, answered, expired, replaced, unknown
}

/// An agent's question to the human with 2 to 4 options. `question` and `options` are the agent's own text.
public struct Question: Codable, Equatable, Identifiable, Sendable {
  public var id: String
  public var room: String
  public var member: String
  public var messageId: Int
  public var question: String
  public var options: [String]
  public var state: QuestionState
  /// The picked option's index, from 0. Nil until answered.
  public var answer: Int?
  public var createdAt: String
  public var answeredAt: String?

  enum CodingKeys: String, CodingKey, CaseIterable {
    case id, room, member, question, options, state, answer
    case messageId = "message_id"
    case createdAt = "created_at"
    case answeredAt = "answered_at"
  }
}

public struct Room: Codable, Equatable, Sendable {
  public var id: String
  public var name: String
  public var topic: String?
  public var createdAt: String
  public var createdBy: String
  public var standing: Bool
  public var closedAt: String?

  enum CodingKeys: String, CodingKey, CaseIterable {
    case id, name, topic, standing
    case createdAt = "created_at"
    case createdBy = "created_by"
    case closedAt = "closed_at"
  }
}

public struct Member: Codable, Equatable, Sendable {
  public var roomId: String
  public var name: String
  public var kind: MemberKind
  public var clientLabel: String?
  public var clientName: String?
  public var clientVersion: String?
  public var presence: Presence
  public var role: String
  public var cursor: Int
  public var done: Bool
  public var joinedAt: String
  public var lastSeenAt: String
  public var leftAt: String?
  public var muted = false
  public var status: String? = nil
  public var statusAt: String? = nil

  enum CodingKeys: String, CodingKey, CaseIterable {
    case name, kind, presence, role, cursor, done, muted, status
    case statusAt = "status_at"
    case roomId = "room_id"
    case clientLabel = "client_label"
    case clientName = "client_name"
    case clientVersion = "client_version"
    case joinedAt = "joined_at"
    case lastSeenAt = "last_seen_at"
    case leftAt = "left_at"
  }
}

public struct Message: Codable, Equatable, Identifiable, Sendable {
  public var id: Int
  public var roomId: String
  public var from: String
  public var fromClientLabel: String? = nil
  public var fromKind: MemberKind? = nil
  public var kind: MessageKind
  public var text: String
  public var mentions: [String]
  public var createdAt: String

  enum CodingKeys: String, CodingKey, CaseIterable {
    case id, from, kind, text, mentions
    case roomId = "room_id"
    case fromClientLabel = "from_client_label"
    case fromKind = "from_kind"
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
  public var messageCount: Int
  public var firstMessageId: Int?
  public var members: [Member]
  public var messages: [Message]
  public var approvals: [Approval] = []
  public var questions: [Question] = []

  public var isOpen: Bool { closedAt == nil }
  /// The asks a seat's agent is waiting on, oldest first.
  public func approvals(for member: String) -> [Approval] { approvals.filter { $0.member == member } }
  public var oldestLoadedId: Int? { messages.first?.id }
  /// True while older messages sit above the loaded ones.
  public var hasMore: Bool {
    guard let firstMessageId, let oldestLoadedId else { return false }
    return oldestLoadedId > firstMessageId
  }
  /// Members still in the room. `members` keeps those who left, so their old posts keep a sender.
  public var present: [Member] { members.filter { $0.presence != .left } }
  /// Members who get their own chip: agents still here, then the human. The human seat never folds away.
  public var liveMembers: [Member] { liveAgents + members.filter { $0.kind == .human } }
  /// Agents who are away or left, folded into one chip at the end of the strip.
  public var awayMembers: [Member] { members.filter { $0.kind != .human && $0.presence.isAway } }
  /// The agents the sidebar counts.
  public var liveAgents: [Member] { members.filter { $0.kind != .human && !$0.presence.isAway } }

  enum CodingKeys: String, CodingKey, CaseIterable {
    case id, name, topic, standing, members, messages, approvals, questions
    case createdAt = "created_at"
    case createdBy = "created_by"
    case closedAt = "closed_at"
    case messageCount = "message_count"
    case firstMessageId = "first_message_id"
  }

  init(room: Room) {
    self.init(
      id: room.id, name: room.name, topic: room.topic, createdAt: room.createdAt, createdBy: room.createdBy,
      standing: room.standing, closedAt: room.closedAt, messageCount: 0, firstMessageId: nil, members: [],
      messages: [])
  }

  init(
    id: String, name: String, topic: String?, createdAt: String, createdBy: String, standing: Bool,
    closedAt: String?, messageCount: Int, firstMessageId: Int?, members: [Member],
    messages: [Message]
  ) {
    self.id = id
    self.name = name
    self.topic = topic
    self.createdAt = createdAt
    self.createdBy = createdBy
    self.standing = standing
    self.closedAt = closedAt
    self.messageCount = messageCount
    self.firstMessageId = firstMessageId
    self.members = members
    self.messages = messages
  }
}

public struct Snapshot: Codable, Equatable, Sendable {
  public var seq: Int
  public var rooms: [SnapshotRoom]
  /// Optional so an older daemon that sends neither still loads.
  public var contractVersion: Int?
  public var version: String?

  enum CodingKeys: String, CodingKey, CaseIterable {
    case seq, rooms, version
    case contractVersion = "contract_version"
  }
}

/// One page of a room's messages, oldest first.
public struct History: Codable, Equatable, Sendable {
  public var messages: [Message]

  enum CodingKeys: String, CodingKey, CaseIterable { case messages }
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

public struct ApprovalEvent: Decodable, Equatable, Sendable {
  public var room: String
  public var approval: Approval

  enum CodingKeys: String, CodingKey, CaseIterable { case type, room, approval }

  public init(room: String, approval: Approval) {
    self.room = room
    self.approval = approval
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    self.init(room: try c.decode(String.self, forKey: .room), approval: try c.decode(Approval.self, forKey: .approval))
  }
}

public struct QuestionEvent: Decodable, Equatable, Sendable {
  public var room: String
  public var question: Question

  enum CodingKeys: String, CodingKey, CaseIterable { case type, room, question }

  public init(room: String, question: Question) {
    self.room = room
    self.question = question
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    self.init(room: try c.decode(String.self, forKey: .room), question: try c.decode(Question.self, forKey: .question))
  }
}

/// One change in the room store, picked by its `type` field.
public enum BusEvent: Decodable, Equatable, Sendable {
  case message(MessageEvent)
  case member(MemberEvent)
  case presence(PresenceEvent)
  case room(RoomEvent)
  case approval(ApprovalEvent)
  case question(QuestionEvent)
  /// A type this build does not know. The store skips it but still moves the sequence.
  case unknown(type: String)

  private enum TypeKey: String, CodingKey { case type }

  /// The room name the event belongs to.
  public var room: String {
    switch self {
    case .message(let e): e.room
    case .member(let e): e.room
    case .presence(let e): e.room
    case .room(let e): e.room.name
    case .approval(let e): e.room
    case .question(let e): e.room
    case .unknown: ""
    }
  }

  public var type: String {
    switch self {
    case .message: "message"
    case .member: "member"
    case .presence: "presence"
    case .room: "room"
    case .approval: "approval"
    case .question: "question"
    case .unknown(let type): type
    }
  }

  public init(from decoder: Decoder) throws {
    let type = try decoder.container(keyedBy: TypeKey.self).decode(String.self, forKey: .type)
    switch type {
    case "message": self = .message(try MessageEvent(from: decoder))
    case "member": self = .member(try MemberEvent(from: decoder))
    case "presence": self = .presence(try PresenceEvent(from: decoder))
    case "room": self = .room(try RoomEvent(from: decoder))
    case "approval": self = .approval(try ApprovalEvent(from: decoder))
    case "question": self = .question(try QuestionEvent(from: decoder))
    default: self = .unknown(type: type)
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

public struct HumanRole: Codable, Equatable, Sendable {
  public var role: String
  public var instructions: String?

  enum CodingKeys: String, CodingKey, CaseIterable { case role, instructions }
}

public struct MuteResult: Codable, Equatable, Sendable {
  public var member: Member

  enum CodingKeys: String, CodingKey, CaseIterable { case member }
}

public struct HumanRoleResult: Codable, Equatable, Sendable {
  public var member: Member
  public var message: Message

  enum CodingKeys: String, CodingKey, CaseIterable { case member, message }
}

public struct RemoveMemberResult: Codable, Equatable, Sendable {
  public var member: Member

  enum CodingKeys: String, CodingKey, CaseIterable { case member }
}

public struct NewRoom: Codable, Equatable, Sendable {
  public var name: String
  public var topic: String?

  enum CodingKeys: String, CodingKey, CaseIterable { case name, topic }

  public init(name: String, topic: String?) {
    self.name = name
    self.topic = topic
  }
}

/// The answer to a new room, a close or a reopen: the room as it is now.
public struct RoomResult: Codable, Equatable, Sendable {
  public var room: Room

  enum CodingKeys: String, CodingKey, CaseIterable { case room }
}

public struct HumanApproval: Codable, Equatable, Sendable {
  public var behavior: String

  enum CodingKeys: String, CodingKey, CaseIterable { case behavior }
}

public struct ApprovalResult: Codable, Equatable, Sendable {
  public var approvals: [Approval]

  enum CodingKeys: String, CodingKey, CaseIterable { case approvals }
}

public struct HumanAnswer: Codable, Equatable, Sendable {
  public var option: Int

  enum CodingKeys: String, CodingKey, CaseIterable { case option }
}

/// The question as answered, and the human line that carries the answer.
public struct AnswerResult: Codable, Equatable, Sendable {
  public var question: Question
  public var message: Message

  enum CodingKeys: String, CodingKey, CaseIterable { case question, message }
}

public struct FeedError: Codable, Equatable, Sendable {
  public var error: String

  enum CodingKeys: String, CodingKey, CaseIterable { case error }
}
