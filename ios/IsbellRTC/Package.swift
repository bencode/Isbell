// swift-tools-version: 6.2
import PackageDescription

// A direct link's WebRTC side, apart from IsbellKit so that it keeps no third-party dependencies.
let package = Package(
    name: "IsbellRTC",
    platforms: [.iOS("26.0"), .macOS("26.0")],
    products: [.library(name: "IsbellRTC", targets: ["IsbellRTC"])],
    dependencies: [
        .package(path: "../IsbellKit"),
        .package(url: "https://github.com/stasel/WebRTC.git", exact: "157.0.0"),
    ],
    targets: [
        .target(name: "IsbellRTC", dependencies: ["IsbellKit", .product(name: "WebRTC", package: "WebRTC")]),
    ]
)
