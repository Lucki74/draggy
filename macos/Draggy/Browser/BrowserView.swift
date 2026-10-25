import DraggyCore
import SwiftUI
import WebKit

/// Pages load in a store of their own, so the app never shares cookies with the sites the user visits.
private let browserStoreID = UUID(uuidString: "6B3F0F7A-1D1E-4C5B-9C57-5E0F7A8D2C11")!

struct BrowserView: View {
    @Bindable var browser: BrowserModel
    @State private var commands = WebCommands()

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button("Back", systemImage: "chevron.left") { commands.back() }
                    .disabled(!browser.canGoBack)
                Button("Forward", systemImage: "chevron.right") { commands.forward() }
                    .disabled(!browser.canGoForward)
                Button("Reload", systemImage: "arrow.clockwise") { commands.reload() }
                    .disabled(browser.current == nil)
                TextField("Address", text: $browser.address)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { browser.go() }
            }
            .labelStyle(.iconOnly)
            .padding(8)
            if let error = browser.errorMessage {
                Text(error)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 8)
                    .padding(.bottom, 4)
            }
            if browser.isLoading { ProgressView().progressViewStyle(.linear) }
            WebPage(browser: browser, commands: commands)
        }
        .navigationTitle(browser.title.isEmpty ? String(localized: "Browser") : browser.title)
    }
}

/// Lets the toolbar buttons reach the web view that SwiftUI owns.
@MainActor
final class WebCommands {
    fileprivate weak var view: WKWebView?
    func back() { view?.goBack() }
    func forward() { view?.goForward() }
    func reload() { view?.reload() }
}

private struct WebPage: NSViewRepresentable {
    let browser: BrowserModel
    let commands: WebCommands

    func makeCoordinator() -> Coordinator { Coordinator(browser: browser) }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: browserStoreID)
        blockAds(in: configuration.userContentController)
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        commands.view = view
        return view
    }

    /// Compiles the shared ad and tracker rules and adds them. Pages load without them until the rules are ready.
    private func blockAds(in controller: WKUserContentController) {
        Task { @MainActor in
            let store = WKContentRuleListStore.default()
            if let list = try? await store?.compileContentRuleList(
                forIdentifier: "draggy-adblock", encodedContentRuleList: adblockRules()
            ) {
                controller.add(list)
            }
        }
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        guard let url = browser.current, context.coordinator.requested != url else { return }
        context.coordinator.requested = url
        view.load(URLRequest(url: url))
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKDownloadDelegate {
        let browser: BrowserModel
        var requested: URL?
        private var saved: URL?

        init(browser: BrowserModel) { self.browser = browser }

        func webView(
            _ webView: WKWebView, decidePolicyFor action: WKNavigationAction
        ) async -> WKNavigationActionPolicy {
            guard let url = action.request.url else { return .cancel }
            guard browser.permits(url) else { return .cancel }
            return action.shouldPerformDownload ? .download : .allow
        }

        /// A response the view cannot show is a file: it is downloaded instead of dropped.
        func webView(
            _ webView: WKWebView, decidePolicyFor response: WKNavigationResponse
        ) async -> WKNavigationResponsePolicy {
            response.canShowMIMEType ? .allow : .download
        }

        func webView(_ webView: WKWebView, navigationAction _: WKNavigationAction, didBecome download: WKDownload) {
            download.delegate = self
        }

        func webView(_ webView: WKWebView, navigationResponse _: WKNavigationResponse, didBecome download: WKDownload) {
            download.delegate = self
        }

        /// Asks where to save the file. Cancelling the panel cancels the download.
        func download(
            _ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String
        ) async -> URL? {
            saved = nil
            let panel = NSSavePanel()
            panel.nameFieldStringValue = suggestedFilename
            guard panel.runModal() == .OK, let url = panel.url else { return nil }
            saved = url
            return url
        }

        func downloadDidFinish(_ download: WKDownload) {
            if let saved { NSWorkspace.shared.activateFileViewerSelecting([saved]) }
        }

        func download(_ download: WKDownload, didFailWithError error: Error, resumeData _: Data?) {
            browser.reportFailure(error.localizedDescription)
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation _: WKNavigation!) { report(webView) }
        func webView(_ webView: WKWebView, didCommit _: WKNavigation!) { report(webView) }
        func webView(_ webView: WKWebView, didFinish _: WKNavigation!) { report(webView) }
        func webView(_ webView: WKWebView, didFail _: WKNavigation!, withError _: Error) { report(webView) }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation _: WKNavigation!, withError _: Error) {
            report(webView)
        }

        private func report(_ view: WKWebView) {
            browser.update(
                url: view.url, title: view.title ?? "", isLoading: view.isLoading,
                canGoBack: view.canGoBack, canGoForward: view.canGoForward)
        }
    }
}
