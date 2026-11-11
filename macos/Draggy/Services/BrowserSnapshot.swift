import AppKit
import OSLog
import Foundation
import WebKit

@MainActor
public final class BrowserSnapshot {
    public static let shared = BrowserSnapshot()

    public init() {}

    public func takeSnapshot(of view: WKWebView) async -> NSImage? {
        let config = WKSnapshotConfiguration()
        do {
            return try await view.takeSnapshot(configuration: config)
        } catch {
            Logger.browser.error("Snapshot failed: \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }
}
