// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "Messhall",
  platforms: [.macOS(.v14)],
  targets: [
    .target(name: "Feed", path: "Sources/Feed"),
    .executableTarget(name: "Messhall", dependencies: ["Feed"], path: "Sources/App"),
    .testTarget(
      name: "FeedTests",
      dependencies: ["Feed"],
      path: "Tests/FeedTests",
      resources: [.copy("Fixtures")]
    ),
  ]
)
