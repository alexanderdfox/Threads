// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "CollatzInfinite",
    platforms: [
        .macOS(.v12)
    ],
    dependencies: [
        .package(url: "https://github.com/attaswift/BigInt.git", from: "5.3.0")
    ],
    targets: [
        .executableTarget(
            name: "CollatzInfinite",
            dependencies: ["BigInt"]
        )
    ]
)
