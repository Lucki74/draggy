import DraggyCore
import SwiftUI

struct ModelsView: View {
    @Bindable var models: ModelsModel

    var body: some View {
        Form {
            Section("On this Mac") {
                if models.installed.isEmpty {
                    Text("No models yet.").foregroundStyle(.secondary)
                }
                ForEach(models.installed, id: \.filename) { model in
                    LabeledContent {
                        HStack {
                            Button("Use") { models.use(model) }
                            Button("Delete", role: .destructive) { models.delete(model) }
                        }
                    } label: {
                        Text(model.filename).lineLimit(1).truncationMode(.middle)
                        Text(ByteCountFormatter.string(fromByteCount: Int64(model.bytes), countStyle: .file))
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Section("Find a model") {
                HStack {
                    TextField("Search", text: $models.query)
                        .onSubmit { Task { await models.search() } }
                    Button("Search") { Task { await models.search() } }
                        .disabled(models.isSearching)
                }
                if let error = models.errorMessage {
                    Text(error).foregroundStyle(.red)
                }
                if let progress = models.progress, let name = models.downloading {
                    VStack(alignment: .leading) {
                        Text("Downloading \(name)")
                        ProgressView(value: progress.percent, total: 100)
                        HStack {
                            Text(remaining(progress)).foregroundStyle(.secondary)
                            Spacer()
                            Button("Cancel") { models.cancelDownload() }
                        }
                    }
                }
                ForEach(models.results, id: \.name) { result in
                    LabeledContent {
                        Button("Download") { Task { await models.download(result.name) } }
                            .disabled(models.downloading != nil)
                    } label: {
                        Text(result.name)
                        Text(result.sizes.joined(separator: ", ")).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding()
        .task { await models.search() }
    }

    private func remaining(_ progress: DownloadProgressRecord) -> String {
        let done = ByteCountFormatter.string(fromByteCount: Int64(progress.completed), countStyle: .file)
        let all = ByteCountFormatter.string(fromByteCount: Int64(progress.total), countStyle: .file)
        guard let seconds = progress.remainingSeconds else { return "\(done) of \(all)" }
        return "\(done) of \(all), about \(seconds / 60 + 1) min left"
    }
}
