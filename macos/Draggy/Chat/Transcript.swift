import Foundation

/// The conversation as the window shows it. Pure value logic, so it is tested without a window or a server.
struct Transcript: Equatable {
    enum Role: Equatable {
        case user
        case assistant
    }

    /// One tool step of a reply, reduced to what the window shows.
    struct Step: Equatable, Hashable, Codable {
        let kind: String
        let label: String
        let isDone: Bool
        /// The reasoning text, or the content and output of a tool call. Empty when the step has none.
        var detail: String = ""
    }

    struct Line: Identifiable, Equatable {
        let id: UUID
        let role: Role
        var text: String
        var steps: [Step] = []
        /// Tokens per second of the reply, once the core reports it.
        var speed: Double?
        /// What the reply cost, once it is priced. Not saved with the conversation.
        var cost: TurnCostLabel?
    }

    private(set) var lines: [Line] = []

    init() {}

    init(restoring saved: [SavedMessage]) {
        lines = saved.compactMap { message in
            switch message.role {
            case "user": Line(id: UUID(), role: .user, text: message.text)
            case "assistant": Line(id: UUID(), role: .assistant, text: message.text, steps: message.steps ?? [])
            default: nil
            }
        }
    }

    /// The finished exchanges, as the core holds them. A question whose reply never came is left out, since the core
    /// dropped it too.
    var savedMessages: [SavedMessage] {
        var saved: [SavedMessage] = []
        var question: Line?
        for line in lines {
            switch line.role {
            case .user:
                question = line
            case .assistant:
                guard let asked = question, !line.text.isEmpty else { continue }
                saved.append(SavedMessage(role: "user", text: asked.text))
                saved.append(SavedMessage(
                    role: "assistant", text: line.text, steps: line.steps.isEmpty ? nil : line.steps))
                question = nil
            }
        }
        return saved
    }

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

    mutating func setCost(_ cost: TurnCostLabel?) {
        guard let last = openReply else { return }
        lines[last].cost = cost
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
