import AppKit
import SwiftUI
import WebKit

/// HTML a model wrote, made safe to show: no scripts run and nothing loads from the network.
final class HTMLPreview: NSObject {
    let html: String

    init(_ html: String) {
        self.html = html
    }

    /// Whether a code fence's language is one to preview.
    static func isHTML(_ language: String) -> Bool {
        ["html", "htm"].contains(language.trimmingCharacters(in: .whitespaces).lowercased())
    }

    private static let policy = "default-src 'none'; style-src 'unsafe-inline'; img-src data:"

    /// The document to load: the model's markup under a policy that blocks scripts and requests.
    static func page(_ code: String) -> String {
        "<!doctype html><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"\(policy)\">\(code)"
    }
}

/// Shows an `HTMLPreview` in its own window.
@MainActor
enum HTMLPreviewWindow {
    private static var windows: [NSWindow] = []

    static func show(_ preview: HTMLPreview) {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        let view = WKWebView(frame: .zero, configuration: configuration)
        let guardrail = Guard()
        view.navigationDelegate = guardrail
        objc_setAssociatedObject(view, &guardKey, guardrail, .OBJC_ASSOCIATION_RETAIN)
        view.loadHTMLString(HTMLPreview.page(preview.html), baseURL: nil)
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 720, height: 520),
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = String(localized: "Preview")
        window.contentView = view
        window.isReleasedWhenClosed = false
        window.center()
        window.makeKeyAndOrderFront(nil)
        windows.append(window)
    }

    private nonisolated(unsafe) static var guardKey: UInt8 = 0

    /// Lets the first load through and ignores every link after it.
    private final class Guard: NSObject, WKNavigationDelegate {
        func webView(
            _ webView: WKWebView,
            decidePolicyFor action: WKNavigationAction,
            decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
        ) {
            decisionHandler(action.navigationType == .other ? .allow : .cancel)
        }
    }
}
