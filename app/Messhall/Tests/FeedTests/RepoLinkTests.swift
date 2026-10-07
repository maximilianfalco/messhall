import Testing

@testable import Feed

@Suite("RepoLink")
struct RepoLinkTests {
  @Test("the GitHub button opens the messhall repo page")
  func repoURL() {
    #expect(RepoLink.url.absoluteString == "https://github.com/maximilianfalco/messhall")
  }
}
