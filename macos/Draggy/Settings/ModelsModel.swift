import DraggyCore
import Foundation
import Observation

/// Forwards download progress to the main actor. The core calls it from the download's own thread.
private final class ProgressSink: DownloadObserver, @unchecked Sendable {
    private let show: @MainActor @Sendable (DownloadProgressRecord) -> Void

    init(show: @escaping @MainActor @Sendable (DownloadProgressRecord) -> Void) {
        self.show = show
    }

    func onProgress(progress: DownloadProgressRecord) {
        let show = show
        Task { @MainActor in show(progress) }
    }
}

/// The model library screen's state: what the hub offers, what is on disk, and the download in progress.
@MainActor
@Observable
final class ModelsModel {
    private let library: ModelLibrary?
    private let useModel: (String) -> Void

    var query = ""
    private(set) var results: [LibraryModelRecord] = []
    private(set) var installed: [InstalledModelRecord] = []
    private(set) var isSearching = false
    /// The reference being downloaded.
    private(set) var downloading: String?
    private(set) var progress: DownloadProgressRecord?
    private(set) var errorMessage: String?

    /// `useModel` receives the path of a model the user picked or just downloaded.
    init(modelsDirectory: URL = ModelsModel.defaultDirectory(), useModel: @escaping (String) -> Void) {
        self.useModel = useModel
        do {
            library = try ModelLibrary(modelsDir: modelsDirectory.path)
        } catch {
            library = nil
            errorMessage = String(localized: "The model library could not start.")
        }
        refreshInstalled()
    }

    static func defaultDirectory() -> URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return support.appendingPathComponent("Draggy", isDirectory: true).appendingPathComponent("models", isDirectory: true)
    }

    func refreshInstalled() {
        guard let library else { return }
        do {
            installed = try library.installed()
        } catch let error as CoreError {
            errorMessage = AppModel.message(for: error)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func search() async {
        guard let library, !isSearching else { return }
        isSearching = true
        errorMessage = nil
        results = await library.search(query: query.trimmingCharacters(in: .whitespacesAndNewlines))
        isSearching = false
    }

    func download(_ reference: String) async {
        guard let library, downloading == nil else { return }
        downloading = reference
        progress = nil
        errorMessage = nil
        let sink = ProgressSink { [weak self] update in self?.progress = update }
        do {
            let filename = try await library.download(reference: reference, observer: sink)
            refreshInstalled()
            if let model = installed.first(where: { $0.filename == filename }) { useModel(model.path) }
        } catch let error as CoreError {
            errorMessage = AppModel.message(for: error)
        } catch {
            errorMessage = error.localizedDescription
        }
        downloading = nil
        progress = nil
    }

    func cancelDownload() {
        guard let name = progress?.filename else { return }
        library?.cancel(filename: name)
    }

    func use(_ model: InstalledModelRecord) {
        useModel(model.path)
    }

    func delete(_ model: InstalledModelRecord) {
        guard let library else { return }
        do {
            _ = try library.delete(filename: model.filename)
        } catch let error as CoreError {
            errorMessage = AppModel.message(for: error)
        } catch {
            errorMessage = error.localizedDescription
        }
        refreshInstalled()
    }
}
