import Foundation
import PDFKit

public final class PDFViewerService: Sendable {
    public static let shared = PDFViewerService()

    public init() {}

    public func loadDocument(from url: URL) -> PDFDocument? {
        return PDFDocument(url: url)
    }
}
