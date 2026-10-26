import Foundation
import WebKit

@MainActor
public final class BrowserControl {
    public static let shared = BrowserControl()

    public init() {}

    public func navigate(view: WKWebView, to urlString: String) {
        if let url = URL(string: urlString), BrowserSafety.shared.isSafeUrl(url) {
            view.load(URLRequest(url: url))
        }
    }

    public func reload(view: WKWebView) {
        view.reload()
    }

    public func goBack(view: WKWebView) {
        if view.canGoBack { view.goBack() }
    }

    public func goForward(view: WKWebView) {
        if view.canGoForward { view.goForward() }
    }
}
