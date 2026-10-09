import Darwin
import Foundation

/// Reads the process table and per-process usage straight from the kernel, the way Activity Monitor does.
public enum ProcessProbe {
  // rusage times are mach ticks, not nanoseconds, on Apple silicon.
  private static let nanosPerTick: Double = {
    var base = mach_timebase_info_data_t()
    mach_timebase_info(&base)
    return Double(base.numer) / Double(base.denom)
  }()

  /// Samples every process, with usage for the trees under `roots` only.
  public static func sample(roots: [Int32], at date: Date = .now) -> ProcessSample {
    let table = table()
    let keys = AgentProcesses.trees(roots: roots, table: table).values.joined()
    let read = keys.compactMap { key in usage(key).map { (key, $0) } }
    return ProcessSample(at: date, table: table, usage: Dictionary(read) { first, _ in first })
  }

  /// Every process with its parent and start time. Empty when the kernel refuses.
  public static func table() -> [ProcessEntry] {
    var mib = [CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0]
    var size = 0
    guard sysctl(&mib, UInt32(mib.count), nil, &size, nil, 0) == 0 else { return [] }
    // Processes can start between the two calls, so leave room for a few more.
    var procs = [kinfo_proc](repeating: kinfo_proc(), count: size / MemoryLayout<kinfo_proc>.stride + 16)
    size = procs.count * MemoryLayout<kinfo_proc>.stride
    guard sysctl(&mib, UInt32(mib.count), &procs, &size, nil, 0) == 0 else { return [] }
    return procs.prefix(size / MemoryLayout<kinfo_proc>.stride).map { proc in
      let started = proc.kp_proc.p_un.__p_starttime
      return ProcessEntry(
        key: ProcessKey(
          pid: proc.kp_proc.p_pid, start: Double(started.tv_sec) + Double(started.tv_usec) / 1_000_000),
        parent: proc.kp_eproc.e_ppid)
    }
  }

  /// Cpu seconds and memory footprint of one process. Nil when it is gone, not ours to read, or its pid now
  /// belongs to a process that started at another time.
  public static func usage(_ key: ProcessKey) -> ProcessUsage? {
    var bsd = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    guard proc_pidinfo(key.pid, PROC_PIDTBSDINFO, 0, &bsd, size) == size else { return nil }
    let started = Double(bsd.pbi_start_tvsec) + Double(bsd.pbi_start_tvusec) / 1_000_000
    guard abs(started - key.start) < 0.001 else { return nil }
    var info = rusage_info_v2()
    let read = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(key.pid, RUSAGE_INFO_V2, $0) }
    }
    guard read == 0 else { return nil }
    let ticks = Double(info.ri_user_time + info.ri_system_time)
    return ProcessUsage(cpu: ticks * nanosPerTick / 1_000_000_000, memory: info.ri_phys_footprint)
  }
}
