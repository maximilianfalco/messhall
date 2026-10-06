import Foundation
import Testing

@testable import Feed

@Suite("FeedConfig")
struct FeedConfigTests {
  private let home = URL(fileURLWithPath: "/Users/someone")

  @Test("defaults to port 7707 and the Application Support data dir")
  func defaults() {
    let config = FeedConfig(environment: [:], home: home)

    #expect(config.baseURL.absoluteString == "http://127.0.0.1:7707")
    #expect(config.humanKeyFile.path == "/Users/someone/Library/Application Support/messhall/human-key")
  }

  @Test("honours MESSHALL_PORT and MESSHALL_HOME")
  func environment() {
    let config = FeedConfig(environment: ["MESSHALL_PORT": "7796", "MESSHALL_HOME": "/tmp/scratch"], home: home)

    #expect(config.baseURL.absoluteString == "http://127.0.0.1:7796")
    #expect(config.humanKeyFile.path == "/tmp/scratch/human-key")
  }

  @Test("falls back to 7707 on a bad port")
  func badPort() {
    #expect(FeedConfig(environment: ["MESSHALL_PORT": "nope"], home: home).baseURL.port == 7707)
  }
}
