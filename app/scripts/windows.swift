// Prints one line per window of a pid, on screen or in another Space: id, layer, width, height.
// app-shot picks the id it hands to screencapture -l.
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 2, let pid = Int(CommandLine.arguments[1]) else {
  FileHandle.standardError.write(Data("usage: windows.swift <pid>\n".utf8))
  exit(2)
}
let info = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
for window in info where window[kCGWindowOwnerPID as String] as? Int == pid {
  let bounds = window[kCGWindowBounds as String] as? [String: Double] ?? [:]
  let fields = [
    window[kCGWindowNumber as String] as? Int ?? 0, window[kCGWindowLayer as String] as? Int ?? 0,
    Int(bounds["Width"] ?? 0), Int(bounds["Height"] ?? 0),
  ]
  print(fields.map(String.init).joined(separator: " "))
}
