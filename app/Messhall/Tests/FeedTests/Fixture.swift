import Foundation
import Testing

@testable import Feed

enum Fixture {
  static func data(_ name: String) throws -> Data {
    let url = try #require(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"))
    return try Data(contentsOf: url)
  }

  static func decode<T: Decodable>(_ type: T.Type, _ name: String) throws -> T {
    try JSONDecoder().decode(type, from: data(name))
  }

  static func text(_ name: String) throws -> String {
    String(decoding: try data(name), as: UTF8.self)
  }
}
