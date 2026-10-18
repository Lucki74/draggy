import DraggyCore
import Foundation
import Observation

/// The browser pane's state: the address the user typed and the page the web view shows.
@MainActor
@Observable
final class BrowserModel {
    private let refusal: (String) -> String

    var address = ""
    private(set) var current: URL?
    private(set) var errorMessage: String?
    private(set) var title = ""
    private(set) var isLoading = false
    private(set) var canGoBack = false
    private(set) var canGoForward = false

    /// `refusal` returns why an address may not open, or an empty string when it may. The user may reach local servers.
    init(refusal: @escaping (String) -> String = { webAddressRefusal(address: $0, allowPrivate: true) }) {
        self.refusal = refusal
    }

    /// Adds `https://` to what the user typed when it has no scheme.
    static func normalize(_ typed: String) -> String {
        let text = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty || text.contains("://") || text.hasPrefix("about:") || text.hasPrefix("javascript:") {
            return text
        }
        return "https://" + text
    }

    func go() {
        let text = BrowserModel.normalize(address)
        guard !text.isEmpty else { return }
        let reason = refusal(text)
        guard reason.isEmpty, let url = URL(string: text) else {
            errorMessage = reason.isEmpty ? String(localized: "This is not a web address.") : reason
            return
        }
        errorMessage = nil
        address = text
        current = url
    }

    /// The web view reports the page it shows.
    func update(url: URL?, title: String, isLoading: Bool, canGoBack: Bool, canGoForward: Bool) {
        if let url { address = url.absoluteString }
        self.title = title
        self.isLoading = isLoading
        self.canGoBack = canGoBack
        self.canGoForward = canGoForward
    }

    /// Whether the web view may follow a link. A refused link shows its reason.
    func permits(_ url: URL) -> Bool {
        let reason = refusal(url.absoluteString)
        if reason.isEmpty { return true }
        errorMessage = reason
        return false
    }
}
