import AppKit
import Foundation
import WebKit

@MainActor
public final class BrowserSnapshot {
    public static let shared = BrowserSnapshot()

    public init() {}

    public func takeSnapshot(of view: WKWebView) async -> NSImage? {
        let config = WKSnapshotConfiguration()
        return try? await view.takeSnapshot(configuration: config)
    }
}
