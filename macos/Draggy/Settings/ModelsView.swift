import DraggyCore
import SwiftUI

/// Settings → Models, as win/src/settings/ModelsPage.tsx lays it out: the models on this Mac, then the
/// Hugging Face search with the download under way.
struct ModelsView: View {
    @Bindable var models: ModelsModel
    @Bindable var engine: EngineModel
    @State private var pendingDelete: InstalledModelRecord?
    @State private var expanded: Set<String> = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                group(String(localized: "Installed")) {
                    if models.installed.isEmpty {
                        Text("No models installed")
                            .font(.ui(13))
                            .foregroundStyle(Theme.textSecondary)
                            .padding(16)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    ForEach(models.installed, id: \.path) { installed in
                        installedRow(installed)
                        if installed.path != models.installed.last?.path {
                            Rectangle().fill(Theme.rule).frame(height: 1).padding(.horizontal, 16)
                        }
                    }
                }
                VStack(alignment: .leading, spacing: 10) {
                    Text("Download a model")
                        .font(.ui(13, .medium))
                        .foregroundStyle(Theme.textSecondary)
                    if let error = models.errorMessage {
                        Text(error)
                            .font(.ui(12))
                            .foregroundStyle(Theme.danger)
                    }
                    if let name = models.downloading {
                        PullProgress(name: name, progress: models.progress) { models.cancelDownload() }
                    }
                    ModelSearchView(models: models, actionTitle: String(localized: "Download")) { reference in
                        Task { await models.download(reference) }
                    }
                }
            }
            .padding(20)
        }
        .background(Theme.surfaceCanvas)
        .task { models.refreshInstalled() }
        .alert(
            "Delete this model?",
            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            presenting: pendingDelete
        ) { installed in
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) { models.delete(installed) }
        } message: { installed in
            Text("\(Self.name(installed)) will be removed from this computer. You can download it again later.")
        }
    }

    private func group<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.ui(13, .medium))
                .foregroundStyle(Theme.textSecondary)
            VStack(spacing: 0) { content() }
                .background(Theme.surfaceBase, in: RoundedRectangle(cornerRadius: Theme.Radius.md))
                .overlay(RoundedRectangle(cornerRadius: Theme.Radius.md).strokeBorder(Theme.rule))
        }
    }

    static func name(_ installed: InstalledModelRecord) -> String {
        URL(fileURLWithPath: installed.filename).deletingPathExtension().lastPathComponent
    }

    /// The quantisation a GGUF file name carries, such as Q4_K_M, or nil when it has none.
    static func quant(_ filename: String) -> String? {
        let pattern = try? NSRegularExpression(pattern: "(?i)(?:UD-)?(?:I?Q\\d[A-Z0-9_]*|F16|BF16|F32|MXFP4)")
        let range = NSRange(filename.startIndex..., in: filename)
        guard let match = pattern?.matches(in: filename, range: range).last,
              let found = Range(match.range, in: filename) else { return nil }
        return filename[found].uppercased()
    }

    private func installedRow(_ installed: InstalledModelRecord) -> some View {
        let inUse = engine.modelPath == installed.path
        let open = expanded.contains(installed.path)
        let size = ByteCountFormatter.string(fromByteCount: Int64(installed.bytes), countStyle: .file)
        let facts = [size, Self.quant(installed.filename), installed.format == "mlx" ? "MLX" : nil]
            .compactMap { $0 }.joined(separator: " \u{00B7} ")
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                Button {
                    if open { expanded.remove(installed.path) } else { expanded.insert(installed.path) }
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(Self.name(installed))
                                .font(.ui(14, .medium))
                                .lineLimit(1)
                                .truncationMode(.middle)
                            Icon(glyph: open ? .caretDown : .caretRight, size: 12)
                                .foregroundStyle(Theme.textTertiary)
                        }
                        HStack(spacing: 6) {
                            Text(facts)
                                .font(.ui(12))
                                .foregroundStyle(Theme.textSecondary)
                            if inUse {
                                Text("Chat")
                                    .font(.ui(11, .medium))
                                    .foregroundStyle(Color(nsColor: Theme.NS.accent(\.ink)))
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 1)
                                    .background(Color(nsColor: Theme.NS.accent(\.soft)), in: Capsule())
                            }
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                Spacer()
                if !inUse {
                    Button("Use") { models.use(installed) }
                        .buttonStyle(PillButtonStyle())
                }
                IconButton(glyph: .trash, label: String(localized: "Delete"), size: 16) { pendingDelete = installed }
                    .disabled(inUse)
                    .opacity(inUse ? 0.3 : 1)
            }
            if open {
                Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 6) {
                    GridRow {
                        Text("File").foregroundStyle(Theme.textSecondary)
                        Text(installed.filename).font(.code(12)).textSelection(.enabled)
                    }
                    GridRow {
                        Text("Format").foregroundStyle(Theme.textSecondary)
                        Text(installed.format.uppercased())
                    }
                    if !installed.capabilities.isEmpty {
                        GridRow {
                            Text("Can use").foregroundStyle(Theme.textSecondary)
                            Text(installed.capabilities.map(ModelSearchView.title).joined(separator: ", "))
                        }
                    }
                }
                .font(.ui(12))
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Theme.Radius.sm))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

/// The Windows PullProgress row: name, bytes and time left, a cancel button, and a thin bar.
struct PullProgress: View {
    let name: String
    let progress: DownloadProgressRecord?
    let cancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(name)
                        .font(.ui(13, .medium))
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Text(status)
                        .font(.ui(12))
                        .foregroundStyle(Theme.textSecondary)
                        .monospacedDigit()
                }
                Spacer()
                IconButton(glyph: .x, label: String(localized: "Cancel"), size: 14, action: cancel)
            }
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.surfaceRaised)
                    Capsule()
                        .fill(Color(nsColor: Theme.NS.accent(\.base)))
                        .frame(width: geometry.size.width * min(max((progress?.percent ?? 0) / 100, 0), 1))
                }
            }
            .frame(height: 4)
        }
        .padding(12)
        .background(Theme.surfaceBase, in: RoundedRectangle(cornerRadius: Theme.Radius.md))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.md).strokeBorder(Theme.rule))
        .accessibilityElement(children: .combine)
    }

    private var status: String {
        guard let progress else { return String(localized: "Starting") }
        let done = ByteCountFormatter.string(fromByteCount: Int64(progress.completed), countStyle: .file)
        let all = ByteCountFormatter.string(fromByteCount: Int64(progress.total), countStyle: .file)
        guard let seconds = progress.remainingSeconds else { return "\(done) / \(all)" }
        return "\(done) / \(all) \u{00B7} " + String(format: "%dm %02ds", Int(seconds / 60), Int(seconds % 60))
    }
}

/// The Models page over the main window, as Windows opens its settings inside the app.
struct ModelsSheet: View {
    @Bindable var model: AppModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Models")
                    .font(.ui(15, .semibold))
                Spacer()
                Button("Done") { dismiss() }
                    .buttonStyle(PillButtonStyle())
                    .keyboardShortcut(.cancelAction)
            }
            .padding(.horizontal, 20)
            .frame(height: 48)
            .overlay(alignment: .bottom) { Rectangle().fill(Theme.rule).frame(height: 1) }
            ModelsView(models: model.models, engine: model.engine)
        }
        .background(Theme.surfaceCanvas)
        .font(.ui(13))
        .foregroundStyle(Theme.textPrimary)
        .tint(model.appearance.accent.color(\.base))
    }
}
