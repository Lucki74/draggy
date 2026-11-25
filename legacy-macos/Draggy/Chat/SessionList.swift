import Foundation
import OSLog

/// Chat holds plain conversations, Code holds sessions inside project folders, as on Windows.
enum AppMode: String, CaseIterable, Sendable {
    case chat, code
}

/// What the sidebar keeps about a conversation beyond its messages.
struct SessionMeta: Codable, Equatable, Sendable {
    /// A name the user gave it, which wins over the opening question.
    var title: String?
    var pinned = false
    /// The project folder a Code session belongs to. Chats have none.
    var project: String?
}

/// `index.json` beside the conversation files. Its name is not an id, so the library never lists it.
struct SessionIndex: Sendable {
    let url: URL

    func load() -> [UUID: SessionMeta] {
        guard let data = try? Data(contentsOf: url),
            let saved = try? JSONDecoder().decode([String: SessionMeta].self, from: data)
        else { return [:] }
        return Dictionary(uniqueKeysWithValues: saved.compactMap { key, meta in
            UUID(uuidString: key).map { ($0, meta) }
        })
    }

    func save(_ entries: [UUID: SessionMeta]) {
        let saved = Dictionary(uniqueKeysWithValues: entries.map { ($0.key.uuidString, $0.value) })
        do {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(saved).write(to: url, options: .atomic)
        } catch {
            Logger.storage.error("Session index save failed: \(error.localizedDescription, privacy: .public)")
        }
    }
}

/// One conversation as a sidebar row.
struct SessionRow: Identifiable, Equatable, Sendable {
    let id: UUID
    let title: String
    let updated: Date
    var pinned = false
    var project: String?
}

/// A titled run of rows. The first section's label may be empty when nothing is grouped.
struct SessionSection: Identifiable, Equatable, Sendable {
    let id: String
    let label: String
    let rows: [SessionRow]
}

enum SessionGrouping: String, CaseIterable, Sendable {
    case date, none
}

enum SessionSorting: String, CaseIterable, Sendable {
    case activity, title
}

/// The sections the sidebar shows, mirroring arrangeSessions in win/src/app/sessionView.ts.
enum SessionArrangement {
    static func sorted(_ rows: [SessionRow], by sorting: SessionSorting) -> [SessionRow] {
        switch sorting {
        case .activity:
            rows.sorted { $0.updated > $1.updated }
        case .title:
            rows.sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
        }
    }

    /// Pinned rows lead, except with no grouping at all. Date buckets match the Windows ones.
    static func sections(
        _ rows: [SessionRow],
        grouping: SessionGrouping,
        sorting: SessionSorting,
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> [SessionSection] {
        let ordered = sorted(rows, by: sorting)
        if grouping == .none {
            return ordered.isEmpty ? [] : [SessionSection(id: "all", label: "", rows: ordered)]
        }

        var sections: [SessionSection] = []
        let pinned = ordered.filter(\.pinned)
        if !pinned.isEmpty {
            sections.append(SessionSection(id: "pinned", label: String(localized: "Pinned"), rows: pinned))
        }

        let today = calendar.startOfDay(for: now)
        let buckets: [(String, String, Date)] = [
            ("today", String(localized: "Today"), today),
            ("yesterday", String(localized: "Yesterday"), calendar.date(byAdding: .day, value: -1, to: today) ?? today),
            ("week", String(localized: "This week"), calendar.date(byAdding: .day, value: -6, to: today) ?? today),
            ("earlier", String(localized: "Earlier"), .distantPast),
        ]
        var rest = ordered.filter { !$0.pinned }
        for (id, label, start) in buckets {
            let inBucket = rest.filter { $0.updated >= start }
            rest.removeAll { $0.updated >= start }
            if !inBucket.isEmpty { sections.append(SessionSection(id: id, label: label, rows: inBucket)) }
        }
        return sections
    }

    /// The whole conversation as Markdown, for saving it outside the app.
    static func markdown(title: String, messages: [SavedMessage]) -> String {
        var parts = ["# \(title)"]
        for message in messages where !message.text.isEmpty {
            let speaker = message.role == "user" ? String(localized: "You") : "Draggy"
            parts.append("**\(speaker)**\n\n\(message.text)")
        }
        return parts.joined(separator: "\n\n") + "\n"
    }
}
