import Foundation

/// One process, told apart from a later one that reuses its pid by when it started.
public struct ProcessKey: Hashable, Sendable {
  public let pid: Int32
  /// Seconds since 1970.
  public let start: Double

  public init(pid: Int32, start: Double) {
    self.pid = pid
    self.start = start
  }
}

public struct ProcessEntry: Equatable, Sendable {
  public let key: ProcessKey
  public let parent: Int32

  public init(key: ProcessKey, parent: Int32) {
    self.key = key
    self.parent = parent
  }
}

/// What the kernel has counted for one process: cpu seconds since it started, and its memory footprint in bytes.
public struct ProcessUsage: Equatable, Sendable {
  public let cpu: Double
  public let memory: UInt64

  public init(cpu: Double, memory: UInt64) {
    self.cpu = cpu
    self.memory = memory
  }
}

/// Every process on the Mac at one moment, with usage for the ones in an agent's tree.
public struct ProcessSample: Sendable {
  public let at: Date
  public let table: [ProcessEntry]
  public let usage: [ProcessKey: ProcessUsage]

  public init(at: Date, table: [ProcessEntry], usage: [ProcessKey: ProcessUsage]) {
    self.at = at
    self.table = table
    self.usage = usage
  }
}

/// One agent session with its children rolled in. Cpu is a percent of one core, nil until two samples exist.
public struct AgentProcessRow: Equatable, Sendable, Identifiable {
  public let agent: RunningAgent
  public let started: Date?
  public let cpu: Double?
  public let memory: UInt64?
  public let processes: Int

  public var id: String { agent.id }
}

public enum AgentProcesses {
  /// Each root's process and everything under it. A root under another root keeps its own tree.
  public static func trees(roots: [Int32], table: [ProcessEntry]) -> [Int32: [ProcessKey]] {
    let children = Dictionary(grouping: table, by: \.parent)
    let byPid = Dictionary(table.map { ($0.key.pid, $0.key) }) { first, _ in first }
    let rootSet = Set(roots)
    var trees: [Int32: [ProcessKey]] = [:]
    for root in roots {
      guard let key = byPid[root] else { continue }
      var found = [key]
      var queue = [root]
      while let pid = queue.popLast() {
        for child in children[pid] ?? [] where child.key.pid != pid && !rootSet.contains(child.key.pid) {
          found.append(child.key)
          queue.append(child.key.pid)
        }
      }
      trees[root] = found
    }
    return trees
  }

  /// One row per agent, in order. Cpu counts only processes seen in both samples, or born since the last one,
  /// so a pid the kernel reused never adds a stranger's cpu time.
  public static func rows(agents: [RunningAgent], previous: ProcessSample?, current: ProcessSample)
    -> [AgentProcessRow]
  {
    let trees = trees(roots: agents.compactMap { $0.pid.map(Int32.init) }, table: current.table)
    return agents.map { agent in
      guard let pid = agent.pid, let tree = trees[Int32(pid)], let root = tree.first else {
        return AgentProcessRow(agent: agent, started: nil, cpu: nil, memory: nil, processes: 0)
      }
      let memory = tree.reduce(UInt64(0)) { $0 + (current.usage[$1]?.memory ?? 0) }
      return AgentProcessRow(
        agent: agent, started: Date(timeIntervalSince1970: root.start), cpu: cpu(tree, previous, current),
        memory: memory, processes: tree.count)
    }
  }

  /// Like "2h 4m": the two biggest units, or seconds under a minute.
  public static func uptime(_ seconds: Double) -> String {
    let total = max(0, Int(seconds))
    let (days, hours, minutes) = (total / 86_400, total % 86_400 / 3_600, total % 3_600 / 60)
    if days > 0 { return "\(days)d \(hours)h" }
    if hours > 0 { return "\(hours)h \(minutes)m" }
    if minutes > 0 { return "\(minutes)m" }
    return "\(total)s"
  }

  /// Like "#dev as api, #qa as rev", or "not in a room".
  public static func seatLine(_ agent: RunningAgent) -> String {
    agent.seats.isEmpty ? "not in a room" : agent.seats.map { "#\($0.room) as \($0.name)" }.joined(separator: ", ")
  }

  private static func cpu(_ tree: [ProcessKey], _ previous: ProcessSample?, _ current: ProcessSample) -> Double? {
    guard let previous else { return nil }
    let interval = current.at.timeIntervalSince(previous.at)
    guard interval > 0 else { return nil }
    let since = previous.at.timeIntervalSince1970
    let used = tree.reduce(0.0) { total, key in
      guard let now = current.usage[key]?.cpu else { return total }
      if let before = previous.usage[key]?.cpu { return total + max(0, now - before) }
      return key.start >= since ? total + now : total
    }
    return used / interval * 100
  }
}
