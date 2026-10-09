import Foundation
import Testing

@testable import Feed

private func agent(_ id: String, pid: Int?) -> RunningAgent {
  RunningAgent(
    branch: nil, cwd: "/code/\(id)", id: id, kind: .claude, reach: .claudeSession, repo: id, room: nil, status: .idle,
    pid: pid)
}

private func entry(_ pid: Int32, parent: Int32, start: Double = 100) -> ProcessEntry {
  ProcessEntry(key: ProcessKey(pid: pid, start: start), parent: parent)
}

private let start = Date(timeIntervalSince1970: 1_000)

private func sample(at offset: Double, _ table: [ProcessEntry], cpu: [Int32: Double], memory: UInt64 = 0)
  -> ProcessSample
{
  let usage = Dictionary(
    uniqueKeysWithValues: table.compactMap { found in
      cpu[found.key.pid].map { (found.key, ProcessUsage(cpu: $0, memory: memory)) }
    })
  return ProcessSample(at: start.addingTimeInterval(offset), table: table, usage: usage)
}

@Suite("AgentProcesses")
struct AgentProcessesTests {
  @Test("rolls children and grandchildren into their agent, but not another agent nested under it")
  func trees() {
    let table = [
      entry(10, parent: 1), entry(11, parent: 10), entry(12, parent: 11), entry(20, parent: 10),
      entry(21, parent: 20), entry(30, parent: 1),
    ]

    let trees = AgentProcesses.trees(roots: [10, 20], table: table)

    #expect(trees[10]?.map(\.pid).sorted() == [10, 11, 12])
    #expect(trees[20]?.map(\.pid).sorted() == [20, 21])
  }

  @Test("bills cpu as the change in each process's cpu time over the interval, and sums memory")
  func cpuAndMemory() {
    let table = [entry(10, parent: 1), entry(11, parent: 10)]
    let before = sample(at: 0, table, cpu: [10: 1.0, 11: 2.0])
    let now = sample(at: 2, table, cpu: [10: 1.5, 11: 3.5], memory: 100)

    let rows = AgentProcesses.rows(agents: [agent("a", pid: 10)], previous: before, current: now)

    #expect(rows.first?.cpu == 100)
    #expect(rows.first?.memory == 200)
    #expect(rows.first?.processes == 2)
    #expect(rows.first?.started == Date(timeIntervalSince1970: 100))
  }

  @Test("never takes a delta across a reused pid")
  func reusedPid() {
    let before = sample(at: 0, [entry(10, parent: 1, start: 100)], cpu: [10: 50])
    let now = sample(at: 2, [entry(10, parent: 1, start: 1_001)], cpu: [10: 0.5])

    let rows = AgentProcesses.rows(agents: [agent("a", pid: 10)], previous: before, current: now)

    #expect(rows.first?.cpu == 25)
    #expect(rows.first?.started == Date(timeIntervalSince1970: 1_001))
  }

  @Test("counts a child that started after the last sample from zero, and skips an older one it never saw")
  func newChild() {
    let before = sample(at: 0, [entry(10, parent: 1)], cpu: [10: 1])
    let table = [entry(10, parent: 1), entry(11, parent: 10, start: 1_001), entry(12, parent: 10, start: 500)]
    let now = sample(at: 2, table, cpu: [10: 1, 11: 1, 12: 9])

    let rows = AgentProcesses.rows(agents: [agent("a", pid: 10)], previous: before, current: now)

    #expect(rows.first?.cpu == 50)
  }

  @Test("shows no usage on the first sample, for an agent with no pid, or one whose process is gone")
  func noUsage() {
    let now = sample(at: 0, [entry(10, parent: 1)], cpu: [10: 1], memory: 5)

    let rows = AgentProcesses.rows(
      agents: [agent("a", pid: 10), agent("b", pid: nil), agent("c", pid: 99)], previous: nil, current: now)

    #expect(rows.map(\.cpu) == [nil, nil, nil])
    #expect(rows.map(\.memory) == [5, nil, nil])
  }

  @Test("reads this test process from the kernel, with its parent, cpu time and memory")
  func probe() throws {
    let me = getpid()
    let found = try #require(ProcessProbe.table().first { $0.key.pid == me })
    let usage = try #require(ProcessProbe.usage(found.key))

    #expect(found.parent == getppid())
    #expect(usage.cpu > 0)
    #expect(usage.memory > 0)
  }

  @Test("reads no usage when the pid now belongs to a process that started at another time")
  func probeReusedPid() throws {
    let found = try #require(ProcessProbe.table().first { $0.key.pid == getpid() })

    #expect(ProcessProbe.usage(ProcessKey(pid: found.key.pid, start: found.key.start - 60)) == nil)
  }

  @Test("decodes a running agent from an older daemon that sends no pid, seats or tmux")
  func olderDaemon() throws {
    let json = #"{"branch":null,"cwd":"/code/a","id":"s-1","kind":"claude","reach":"claude_session","repo":null,"room":null,"status":"idle"}"#

    let decoded = try JSONDecoder().decode(RunningAgent.self, from: Data(json.utf8))

    #expect(decoded.pid == nil)
    #expect(decoded.seats == [])
  }

  @Test(
    "says how long an agent has run in its two biggest units",
    arguments: [(45.0, "45s"), (725.0, "12m"), (7_440.0, "2h 4m"), (266_409.0, "3d 2h")] as [(Double, String)])
  func uptime(seconds: Double, text: String) {
    #expect(AgentProcesses.uptime(seconds) == text)
  }

  @Test("names every seat an agent holds, or says it is not in a room")
  func seatLine() {
    var seated = agent("a", pid: 10)
    seated.seats = [RunningSeat(name: "api", room: "dev"), RunningSeat(name: "rev", room: "qa")]

    #expect(AgentProcesses.seatLine(seated) == "#dev as api, #qa as rev")
    #expect(AgentProcesses.seatLine(agent("b", pid: 10)) == "not in a room")
  }
}
