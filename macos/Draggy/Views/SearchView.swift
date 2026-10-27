import SwiftUI

public struct SearchView: View {
    @State private var store: SearchStore

    public init(rootPath: String = FileManager.default.currentDirectoryPath) {
        self._store = State(initialValue: SearchStore(rootPath: rootPath))
    }

    public var body: some View {
        HSplitView {
            VStack(spacing: 0) {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(.secondary)
                    TextField("Search in files...", text: $store.query)
                        .textFieldStyle(.plain)
                        .onSubmit {
                            store.executeSearch()
                        }
                    if !store.query.isEmpty {
                        Button {
                            store.query = ""
                            store.results = []
                            store.selectedResult = nil
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(8)
                .background(Color(nsColor: .controlBackgroundColor))

                Divider()

                if store.isSearching {
                    ProgressView("Searching...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if store.results.isEmpty {
                    VStack(spacing: 8) {
                        Text(store.query.isEmpty ? "Type to search files" : "No results found")
                            .foregroundStyle(.secondary)
                            .font(.caption)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    HStack {
                        Text("\(store.results.count) results")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Spacer()
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)

                    Divider()

                    ScrollView {
                        LazyVStack(spacing: 2) {
                            ForEach(store.results) { item in
                                SearchResultView(item: item, isSelected: store.selectedResult?.id == item.id)
                                    .contentShape(Rectangle())
                                    .onTapGesture {
                                        store.selectedResult = item
                                    }
                            }
                        }
                        .padding(6)
                    }
                }
            }
            .frame(minWidth: 260, idealWidth: 320)

            SearchPreviewView(result: store.selectedResult)
                .frame(minWidth: 300)
        }
    }
}
