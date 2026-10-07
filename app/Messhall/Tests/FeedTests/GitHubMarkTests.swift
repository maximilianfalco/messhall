import AppKit
import Testing

@testable import Feed

@Suite("GitHub mark")
@MainActor
struct GitHubMarkTests {
  private func alpha(_ image: NSImage, x: Int, y: Int) throws -> CGFloat {
    let tiff = try #require(image.tiffRepresentation)
    let bitmap = try #require(NSBitmapImageRep(data: tiff))
    let scale = Int(bitmap.pixelsWide) / Int(image.size.width)
    return try #require(bitmap.colorAt(x: x * scale, y: y * scale)).alphaComponent
  }

  @Test("the image is a 16 point template, so menus and the toolbar tint it")
  func template() {
    let image = GitHubMark.image
    #expect(image.isTemplate)
    #expect(image.size == NSSize(width: 16, height: 16))
  }

  @Test("the image draws the mark: the ring is inked, the face and the corners are clear")
  func drawn() throws {
    let image = GitHubMark.image
    #expect(try alpha(image, x: 8, y: 1) > 0.9)
    #expect(try alpha(image, x: 8, y: 8) < 0.1)
    #expect(try alpha(image, x: 0, y: 0) < 0.1)
  }
}
