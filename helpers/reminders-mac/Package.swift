// swift-tools-version:5.9
// The Mantel Reminders helper: a menu-bar app for a Mac that keeps Apple Reminders lists in step
// with Mantel lists. `MantelSyncCore` is plain Foundation (the protocol and the sync loop, tested
// with XCTest); `MantelReminders` is the app (EventKit, AppKit, the menu).
import PackageDescription

let package = Package(
    name: "MantelReminders",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "MantelReminders", targets: ["MantelReminders"]),
        .library(name: "MantelSyncCore", targets: ["MantelSyncCore"]),
    ],
    targets: [
        .target(name: "MantelSyncCore"),
        .executableTarget(name: "MantelReminders", dependencies: ["MantelSyncCore"]),
        .testTarget(name: "MantelSyncCoreTests", dependencies: ["MantelSyncCore"]),
    ]
)
