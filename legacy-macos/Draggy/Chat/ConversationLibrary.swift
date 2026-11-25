import Foundation

/// One saved conversation as the sidebar lists it.
struct ConversationSummary: Identifiable, Equatable, Sendable {
    let id: UUID
    let title: String
    let updated: Date
}

/// Keeps every conversation as its own JSON file in a folder, named by id.
struct ConversationLibrary: Sendable {
    let folder: URL

    /// `~/Library/Application Support/Draggy/Conversations`, taking in the single file older builds wrote.
    static var standard: ConversationLibrary {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Draggy")
        let library = ConversationLibrary(folder: base.appendingPathComponent("Conversations"))
        library.adopt(legacy: base.appendingPathComponent("conversation.json"))
        return library
    }

    private func store(_ id: UUID) -> ConversationStore {
        ConversationStore(url: folder.appendingPathComponent("\(id.uuidString).json"))
    }

    func load(_ id: UUID) -> [SavedMessage] { store(id).load() }

    func save(_ messages: [SavedMessage], as id: UUID) { store(id).save(messages) }

    func delete(_ id: UUID) { store(id).save([]) }

    /// Newest first. Files that are not conversations, or hold none, are left out.
    func list() -> [ConversationSummary] {
        let keys: [URLResourceKey] = [.contentModificationDateKey]
        let files = (try? FileManager.default.contentsOfDirectory(
            at: folder, includingPropertiesForKeys: keys)) ?? []
        return files.compactMap { file in
            guard file.pathExtension == "json",
                let id = UUID(uuidString: file.deletingPathExtension().lastPathComponent),
                let first = ConversationStore(url: file).load().first(where: { $0.role == "user" })
            else { return nil }
            let date = (try? file.resourceValues(forKeys: Set(keys)).contentModificationDate) ?? .distantPast
            return ConversationSummary(id: id, title: Self.title(of: first.text), updated: date)
        }
        .sorted { $0.updated > $1.updated }
    }

    /// The first line of the opening question, cut to fit a sidebar row.
    static func title(of text: String) -> String {
        let line = text.split(whereSeparator: \.isNewline).first.map(String.init) ?? text
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        return trimmed.count > 60 ? String(trimmed.prefix(60)) + "…" : trimmed
    }

    /// Moves the one-file history of earlier builds in as a conversation, once.
    func adopt(legacy: URL) {
        guard FileManager.default.fileExists(atPath: legacy.path) else { return }
        let messages = ConversationStore(url: legacy).load()
        if !messages.isEmpty { save(messages, as: UUID()) }
        try? FileManager.default.removeItem(at: legacy)
    }
}
