import Foundation

public final class PptxCreator: Sendable {
    public static let shared = PptxCreator()

    public init() {}

    public func createPresentation(slides: [(title: String, bullets: [String])], outputPath: String) throws {
        var content = ""
        for (idx, slide) in slides.enumerated() {
            content += "# Slide \(idx + 1): \(slide.title)\n"
            for b in slide.bullets {
                content += "- \(b)\n"
            }
            content += "\n"
        }
        try content.write(toFile: outputPath, atomically: true, encoding: .utf8)
    }
}
