import Testing

@testable import Feed

@Suite("SSEParser")
struct SSEParserTests {
  @Test("reads an event with its id, name and data")
  func event() {
    var parser = SSEParser()

    let items = parser.push("id: 12\nevent: message\ndata: {\"a\":1}\n\n")

    #expect(items == [.event(id: "12", name: "message", data: "{\"a\":1}")])
  }

  @Test("reads a ping comment as a ping")
  func ping() {
    var parser = SSEParser()

    #expect(parser.push(": ping\n\n") == [.ping])
  }

  @Test("joins a frame split across chunks")
  func splitChunk() {
    var parser = SSEParser()

    let first = parser.push("id: 3\nevent: pres")
    let second = parser.push("ence\ndata: {}\n")
    let third = parser.push("\nid: 4\n")

    #expect(first == [])
    #expect(second == [])
    #expect(third == [.event(id: "3", name: "presence", data: "{}")])
  }

  @Test("joins data lines with newlines and accepts CRLF")
  func multiLineData() {
    var parser = SSEParser()

    let items = parser.push("event: room\r\ndata: one\r\ndata: two\r\n\r\n")

    #expect(items == [.event(id: nil, name: "room", data: "one\ntwo")])
  }

  @Test("names an event with no event line message")
  func defaultName() {
    var parser = SSEParser()

    #expect(parser.push("data: x\n\n") == [.event(id: nil, name: "message", data: "x")])
  }
}
