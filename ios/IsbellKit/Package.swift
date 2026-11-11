// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "IsbellKit",
    platforms: [.iOS("26.0"), .macOS("26.0")],
    products: [.library(name: "IsbellKit", targets: ["IsbellKit"])],
    targets: [
        .target(name: "IsbellKit"),
        .testTarget(name: "IsbellKitTests", dependencies: ["IsbellKit"]),
    ]
)
