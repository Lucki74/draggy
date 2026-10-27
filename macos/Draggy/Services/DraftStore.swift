import Foundation

public struct DraftItem: Identifiable, Codable, Sendable {
    public let id: String
    public var title: String
    public var content: String
    public var updatedAt: Date

    public init(id: String = UUID().uuidString, title: String, content: String, updatedAt: Date = Date()) {
        self.id = id
        self.title = title
        self.content = content
        self.updatedAt = updatedAt
    }
}

@MainActor
@Observable
public final class DraftStore {
    public var drafts: [DraftItem] = []
    public var activeDraftId: String?

    public init() {}

    public func createDraft(title: String = "Untitled Draft", content: String = "") -> DraftItem {
        let draft = DraftItem(title: title, content: content)
        drafts.insert(draft, at: 0)
        activeDraftId = draft.id
        return draft
    }

    public func updateActiveDraft(content: String, title: String? = nil) {
        guard let id = activeDraftId, let idx = drafts.firstIndex(where: { $0.id == id }) else { return }
        drafts[idx].content = content
        if let title { drafts[idx].title = title }
        drafts[idx].updatedAt = Date()
    }

    public func deleteDraft(id: String) {
        drafts.removeAll { $0.id == id }
        if activeDraftId == id {
            activeDraftId = drafts.first?.id
        }
    }
}
