import Testing

@testable import Feed

@Suite("Avatar")
struct AvatarTests {
  static let devRoom = [
    "orchestrator", "f3-human-rooms", "f7-app-rooms", "f8-agent-compat", "f8-agents-doc",
    "f8-codex-doctor", "f8-export", "f8-launchers", "f8-notifications", "f8-search",
  ]

  @Test("a name gets the same hue every time")
  func stable() {
    #expect(avatarHue(for: "f8-search") == avatarHue(for: "f8-search"))
    #expect(avatarHue(for: "f8-search") == 138)
    #expect(avatarHue(for: "orchestrator") == 97)
  }

  @Test("the ten dev room names get ten different hues")
  func devRoomDiffers() {
    #expect(Set(Self.devRoom.map { avatarHue(for: $0) }).count == Self.devRoom.count)
  }

  @Test("most of a hundred names get their own hue")
  func mostDiffer() {
    let names = (1...100).map { "agent-\($0)" }
    #expect(Set(names.map { avatarHue(for: $0) }).count >= 85)
  }

  @Test("the label is the first letter, or the first letters of the first two parts", arguments: [
    ("f8-search", "FS"), ("orchestrator", "O"), ("f3-human-rooms", "FH"), ("web", "W"), ("-api", "A"),
    ("a--b", "AB"), ("", "?"),
  ])
  func label(name: String, expected: String) {
    #expect(avatarLabel(for: name) == expected)
  }

  @Test("white text on every hue's fill passes WCAG AA")
  func contrastTable() {
    for hue in 0..<360 {
      #expect(contrastRatio(avatarFill(hue: hue), .white) >= 4.5, "hue \(hue)")
    }
  }

  @Test("fills stay bright enough to read as color, not near black")
  func notMuddy() {
    for hue in 0..<360 {
      #expect(contrastRatio(avatarFill(hue: hue), .black) >= 2, "hue \(hue)")
    }
  }

  @Test("the contrast ratio matches the WCAG formula")
  func ratio() {
    #expect(abs(contrastRatio(.white, .black) - 21) < 0.001)
    #expect(abs(contrastRatio(.white, .white) - 1) < 0.001)
  }
}
