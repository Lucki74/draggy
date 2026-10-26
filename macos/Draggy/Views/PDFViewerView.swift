import AppKit
import PDFKit
import SwiftUI

public struct PDFKitRepresentable: NSViewRepresentable {
    let url: URL

    public func makeNSView(context: Context) -> PDFView {
        let pdfView = PDFView()
        pdfView.autoScales = true
        pdfView.document = PDFDocument(url: url)
        return pdfView
    }

    public func updateNSView(_ nsView: PDFView, context: Context) {
        if nsView.document?.documentURL != url {
            nsView.document = PDFDocument(url: url)
        }
    }
}

public struct PDFViewerView: View {
    public let url: URL

    public init(url: URL) {
        self.url = url
    }

    public var body: some View {
        PDFKitRepresentable(url: url)
    }
}
