import Foundation

/// The lines a human pastes to get an agent into a room.
public enum JoinPrompt {
  /// One line any agent with the messhall MCP tools can act on.
  public static func prompt(room: String) -> String {
    "Join the messhall room #\(room) with the messhall MCP tools: call join (room \"\(room)\", as a short name you pick for yourself from the work you own, like api or web, Codex also passes thread_id from $CODEX_THREAD_ID), then call wait and reply only to what concerns you."
  }

  public static func launchCommand(room: String) -> String {
    "messhall claude --room \(room)"
  }

  /// The copy button's name, which says Copied for a moment after a click.
  public static func buttonLabel(copied: Bool) -> String {
    copied ? "Copied" : "Copy Join Prompt"
  }
}

/// What an empty transcript says: how to bring an agent in, or that posts are on the way.
public enum EmptyRoomCopy: Equatable, Sendable {
  case startAgent
  case waitForPosts

  public static func pick(members: [Member]) -> EmptyRoomCopy {
    members.contains { $0.kind != .human && $0.presence != .left } ? .waitForPosts : .startAgent
  }
}
