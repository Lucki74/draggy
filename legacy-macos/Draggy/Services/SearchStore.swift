import Foundation
import SwiftUI

@MainActor
@Observable
public final class SearchStore {
    public var query: String = ""
    public var results: [SearchResultItem] = []
    public var selectedResult: SearchResultItem?
    public var isSearching: Bool = false
    public var rootPath: String

    public init(rootPath: String = FileManager.default.currentDirectoryPath) {
        self.rootPath = rootPath
    }

    public func executeSearch() {
        guard !query.trimmingCharacters(in: .whitespaces).isEmpty else {
            results = []
            selectedResult = nil
            return
        }

        isSearching = true
        let q = query
        let p = rootPath

        Task.detached(priority: .userInitiated) {
            let res = SearchEngine.shared.search(query: q, in: p)
            await MainActor.run {
                self.results = res
                self.selectedResult = res.first
                self.isSearching = false
            }
        }
    }
}
