import Foundation

/// The conversation as the window shows it. Pure value logic, so it is tested without a window or a server.
struct Transcript: Equatable {
    enum Role: Equatable {
        case user
        case assistant
    }

    struct Line: Identifiable, Equatable {
        let id: UUID
        let role: Role
        var text: String
    }

    private(set) var lines: [Line] = []

    mutating func addUser(_ text: String) {
        lines.append(Line(id: UUID(), role: .user, text: text))
    }

    /// Opens an empty reply that streamed text will fill.
    mutating func beginReply() {
        lines.append(Line(id: UUID(), role: .assistant, text: ""))
    }

    /// Streamed events carry the whole text so far, so the reply is replaced, not appended to.
    mutating func setReply(_ text: String) {
        guard let last = lines.indices.last, lines[last].role == .assistant else { return }
        lines[last].text = text
    }

    /// The final text wins over the last streamed one, unless the turn produced none.
    mutating func finishReply(_ text: String) {
        guard !text.isEmpty else { return }
        setReply(text)
    }
}
