import Testing

@testable import Feed

@Suite("RoomName")
struct RoomNameTests {
  @Test("a name of lowercase letters, digits and dashes passes", arguments: ["a", "release-notes", "q4-2026", String(repeating: "x", count: 40)])
  func valid(name: String) {
    #expect(RoomName.problem(name, taken: []) == nil)
  }

  @Test("an empty name has no problem to show yet")
  func empty() {
    #expect(RoomName.problem("", taken: []) == nil)
    #expect(!RoomName.isValid("", taken: []))
  }

  @Test("a name with other characters says which ones are allowed", arguments: ["Release", "release notes", "notes_v2", "café", "#dev"])
  func badCharacters(name: String) {
    #expect(RoomName.problem(name, taken: []) == "Use lowercase letters, numbers and dashes.")
    #expect(!RoomName.isValid(name, taken: []))
  }

  @Test("a name over 40 characters says the limit")
  func tooLong() {
    #expect(RoomName.problem(String(repeating: "x", count: 41), taken: []) == "Keep it to 40 characters or fewer.")
  }

  @Test("a name already in use says so")
  func taken() {
    #expect(RoomName.problem("checkout", taken: ["billing", "checkout"]) == "#checkout already exists.")
    #expect(RoomName.isValid("checkout-2", taken: ["checkout"]))
  }
}
