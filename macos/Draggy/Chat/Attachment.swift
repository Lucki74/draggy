import Foundation

/// How a document's text is laid into the message being written.
enum Attachment {
    static func append(_ text: String, named name: String, to draft: String) -> String {
        let block = "[\(name)]\n\(text.trimmingCharacters(in: .whitespacesAndNewlines))"
        let existing = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        return existing.isEmpty ? block + "\n\n" : existing + "\n\n" + block + "\n\n"
    }
}
