/// One thing read off the event stream.
public enum SSEItem: Equatable, Sendable {
  case event(id: String?, name: String, data: String)
  case ping
}

/// Turns raw SSE text into items. Chunks may cut a line or a frame anywhere.
public struct SSEParser: Sendable {
  private var partial = ""
  private var id: String?
  private var name: String?
  private var data: [String] = []

  public init() {}

  public mutating func push(_ chunk: String) -> [SSEItem] {
    partial += chunk
    var items: [SSEItem] = []
    while let newline = partial.firstIndex(where: { $0 == "\n" || $0 == "\r\n" }) {
      var line = String(partial[..<newline])
      partial.removeSubrange(...newline)
      if line.hasSuffix("\r") { line.removeLast() }
      if let item = take(line) { items.append(item) }
    }
    return items
  }

  private mutating func take(_ line: String) -> SSEItem? {
    if line.isEmpty { return flush() }
    if line.hasPrefix(":") { return .ping }
    let field = line.prefix { $0 != ":" }
    var value = line.dropFirst(field.count + 1)
    if value.hasPrefix(" ") { value = value.dropFirst() }
    switch field {
    case "id": id = String(value)
    case "event": name = String(value)
    case "data": data.append(String(value))
    default: break
    }
    return nil
  }

  private mutating func flush() -> SSEItem? {
    defer {
      id = nil
      name = nil
      data = []
    }
    guard !data.isEmpty else { return nil }
    return .event(id: id, name: name ?? "message", data: data.joined(separator: "\n"))
  }
}
