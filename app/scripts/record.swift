// Records one window of a pid to a mov at up to 60 fps: record.swift <pid> <seconds> <out.mov>.
// screencapture -v grabs a screen region, so any window on top lands in the take. This reads only the app's window.
import AVFoundation
import AppKit
import Foundation
import ScreenCaptureKit

guard CommandLine.arguments.count == 4, let pid = Int32(CommandLine.arguments[1]),
  let seconds = Double(CommandLine.arguments[2])
else {
  FileHandle.standardError.write(Data("usage: record.swift <pid> <seconds> <out.mov>\n".utf8))
  exit(2)
}
let out = URL(fileURLWithPath: CommandLine.arguments[3])
// ScreenCaptureKit asserts unless the window server link is up first.
_ = NSApplication.shared

final class Writer: NSObject, SCStreamOutput, @unchecked Sendable {
  let writer: AVAssetWriter
  let input: AVAssetWriterInput
  var started = false

  init(url: URL, width: Int, height: Int) throws {
    try? FileManager.default.removeItem(at: url)
    writer = try AVAssetWriter(outputURL: url, fileType: .mov)
    input = AVAssetWriterInput(
      mediaType: .video,
      outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height])
    input.expectsMediaDataInRealTime = true
    writer.add(input)
    writer.startWriting()
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .screen, buffer.isValid, isComplete(buffer) else { return }
    if !started {
      writer.startSession(atSourceTime: buffer.presentationTimeStamp)
      started = true
    }
    if input.isReadyForMoreMediaData { input.append(buffer) }
  }

  // Idle frames carry no image, only a note that nothing changed.
  private func isComplete(_ buffer: CMSampleBuffer) -> Bool {
    let attachments = CMSampleBufferGetSampleAttachmentsArray(buffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]]
    let raw = attachments?.first?[.status] as? Int
    return raw.flatMap(SCFrameStatus.init(rawValue:)) == .complete
  }
}

let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
let windows = content.windows.filter { $0.owningApplication?.processID == pid && $0.windowLayer <= NSWindow.Level.floating.rawValue }
guard let window = windows.max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }) else {
  FileHandle.standardError.write(Data("no window for pid \(pid)\n".utf8))
  exit(1)
}
let config = SCStreamConfiguration()
config.width = Int(window.frame.width) * 2
config.height = Int(window.frame.height) * 2
config.minimumFrameInterval = CMTime(value: 1, timescale: 60)
config.showsCursor = false
let writer = try Writer(url: out, width: config.width, height: config.height)
let stream = SCStream(filter: SCContentFilter(desktopIndependentWindow: window), configuration: config, delegate: nil)
try stream.addStreamOutput(writer, type: .screen, sampleHandlerQueue: DispatchQueue(label: "record"))
try await stream.startCapture()
print("recording")
try await Task.sleep(for: .seconds(seconds))
await stream.stopCapture()
writer.input.markAsFinished()
await writer.writer.finishWriting()
print(out.path)
