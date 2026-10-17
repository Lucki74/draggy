import Foundation

/// The conversation as the window shows it. Pure value logic, so it is tested without a window or a server.
struct Transcript: Equatable {
    enum Role: Equatable {
        case user
        case assistant
    }

    /// One tool step of a reply, reduced to what the window shows.
    struct Step: Equatable, Hashable {
        let kind: String
        let label: String
        let isDone: Bool
    }

    struct Line: Identifiable, Equatable {
        let id: UUID
        let role: Role
        var text: String
        var steps: [Step] = []
        /// Tokens per second of the reply, once the core reports it.
        var speed: Double?
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
        guard let last = openReply else { return }
        lines[last].text = text
    }

    mutating func setSteps(_ steps: [Step]) {
        guard let last = openReply else { return }
        lines[last].steps = steps
    }

    mutating func setSpeed(_ speed: Double) {
        guard let last = openReply else { return }
        lines[last].speed = speed
    }

    /// The final text wins over the last streamed one, unless the turn produced none.
    mutating func finishReply(_ text: String) {
        guard !text.isEmpty else { return }
        setReply(text)
    }

    private var openReply: Int? {
        guard let last = lines.indices.last, lines[last].role == .assistant else { return nil }
        return last
    }
}
