import AppKit
import Foundation

public final class BrowserDialogs: Sendable {
    public static let shared = BrowserDialogs()

    public init() {}

    public func showAlert(message: String) {
        Task { @MainActor in
            let alert = NSAlert()
            alert.messageText = message
            alert.runModal()
        }
    }
}
