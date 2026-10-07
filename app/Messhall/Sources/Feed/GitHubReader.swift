import Foundation

/// Where Homebrew puts `gh`. An app opened from Finder has no shell PATH to find it by.
private let ghPaths = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"]
private let ghFields = "title,state,isDraft,labels,statusCheckRollup"
private let ghTimeout: Duration = .seconds(20)

/// Reads one pull request through the user's own `gh` login, so the app holds no GitHub token.
/// Nil when gh is missing, logged out, offline or cannot see the repo.
public func readPullRequest(_ link: PullRequestLink) async -> PullRequestCard? {
  guard let gh = ghPaths.first(where: FileManager.default.isExecutableFile) else { return nil }
  let data = await runGH(gh, ["pr", "view", link.url.absoluteString, "--json", ghFields])
  return data.flatMap { PullRequestCard(link: link, ghJSON: $0) }
}

/// Blocks until gh exits, or kills it after `ghTimeout` so a hung network call never piles up.
/// Runs gh on its own thread, not the shared task pool, so many hung reads cannot starve the kill timer.
func runGH(_ gh: String, _ args: [String], timeout: Duration = ghTimeout) async -> Data? {
  await withCheckedContinuation { done in
    Thread { done.resume(returning: runGHBlocking(gh, args, timeout: timeout)) }.start()
  }
}

private func runGHBlocking(_ gh: String, _ args: [String], timeout: Duration) -> Data? {
  let process = Process()
  let out = Pipe()
  process.executableURL = URL(fileURLWithPath: gh)
  process.arguments = args
  process.standardOutput = out
  process.standardError = FileHandle.nullDevice
  guard (try? process.run()) != nil else { return nil }
  let timer = Task {
    try await Task.sleep(for: timeout)
    process.terminate()
  }
  // Read to the end before waiting, so a big answer cannot fill the pipe and stall gh.
  let data = out.fileHandleForReading.readDataToEndOfFile()
  process.waitUntilExit()
  timer.cancel()
  return process.terminationStatus == 0 ? data : nil
}
