import SwiftUI

public struct DraftsView: View {
    @Bindable var store: DraftStore

    public init(store: DraftStore) {
        self.store = store
    }

    public var body: some View {
        HSplitView {
            VStack(spacing: 0) {
                HStack {
                    Text("DRAFTS")
                        .font(.caption)
                        .fontWeight(.bold)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button {
                        _ = store.createDraft()
                    } label: {
                        Image(systemName: "square.and.pencil")
                    }
                    .buttonStyle(.plain)
                }
                .padding(8)
                .background(Color(nsColor: .controlBackgroundColor))

                Divider()

                List(store.drafts, selection: $store.activeDraftId) { draft in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(draft.title)
                            .font(.subheadline)
                            .fontWeight(.medium)
                            .lineLimit(1)
                        Text(draft.content.isEmpty ? "Empty draft" : draft.content)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    .tag(draft.id)
                    .contextMenu {
                        Button("Delete", role: .destructive) {
                            store.deleteDraft(id: draft.id)
                        }
                    }
                }
            }
            .frame(minWidth: 180, idealWidth: 220)

            if let activeId = store.activeDraftId, let idx = store.drafts.firstIndex(where: { $0.id == activeId }) {
                VStack(alignment: .leading, spacing: 8) {
                    TextField("Draft Title", text: $store.drafts[idx].title)
                        .font(.title3)
                        .fontWeight(.bold)
                        .textFieldStyle(.plain)
                        .padding(.horizontal, 12)
                        .padding(.top, 10)

                    Divider()

                    TextEditor(text: $store.drafts[idx].content)
                        .font(.body)
                        .padding(8)
                }
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "doc.text")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                    Text("Select or create a draft")
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
}
