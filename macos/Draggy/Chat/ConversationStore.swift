import Foundation

/// One message as it is kept on disk.
struct SavedMessage: Codable, Equatable, Sendable {
    let role: String
    let text: String
}

/// Keeps the latest conversation in a JSON file, so the window can show it again and the core can pick it up.
struct ConversationStore: Sendable {
    let url: URL

    /// `~/Library/Application Support/Draggy/conversation.json`.
    static var standard: ConversationStore {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return ConversationStore(url: base.appendingPathComponent("Draggy/conversation.json"))
    }

    /// A missing or unreadable file gives an empty conversation.
    func load() -> [SavedMessage] {
        guard let data = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([SavedMessage].self, from: data)) ?? []
    }

    func save(_ messages: [SavedMessage]) {
        if messages.isEmpty {
            try? FileManager.default.removeItem(at: url)
            return
        }
        do {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(messages).write(to: url, options: .atomic)
        } catch {
            // The conversation stays on screen; only the next launch loses it.
        }
    }
}
