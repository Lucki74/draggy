import Foundation

public final class DocumentRenderer: Sendable {
    public static let shared = DocumentRenderer()

    public init() {}

    public func renderMarkdownToHtml(_ markdown: String) -> String {
        return "<html><body><pre>\(markdown)</pre></body></html>"
    }
}
