import Foundation

public final class DocxCreator: Sendable {
    public static let shared = DocxCreator()

    public init() {}

    public func createDocument(title: String, paragraphs: [String], outputPath: String) throws {
        // Creates a basic XML-based document representation or writes text
        let xml = """
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p><w:r><w:t>\(title)</w:t></w:r></w:p>
            \(paragraphs.map { "<w:p><w:r><w:t>\($0)</w:t></w:r></w:p>" }.joined(separator: "\n"))
          </w:body>
        </w:document>
        """
        try xml.write(toFile: outputPath, atomically: true, encoding: .utf8)
    }
}
