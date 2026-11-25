import AppKit
import DraggyCore
import SwiftUI
import UniformTypeIdentifiers

/// The Windows composer: a rounded card with the message field over a row of controls, and in Code the
/// project and branch underneath.
struct ComposerView: View {
    @Bindable var model: AppModel
    @Environment(\.openSettings) private var openSettings
    @State private var isPickingFile = false
    @State private var branch: String?
    @State private var isChoosingModel = false
    @FocusState private var isFocused: Bool

    static let attachmentTypes: [UTType] = (["docx", "pptx", "xlsx", "pdf", "png", "jpg", "jpeg", "gif", "webp"]
        + AppModel.videoTypes)
        .compactMap { UTType(filenameExtension: $0) }

    private var canSend: Bool {
        !model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var placeholder: String {
        if model.mode == .code { return String(localized: "Ask anything, @ to mention, / for actions") }
        return model.transcript.lines.isEmpty
            ? String(localized: "Ask anything, / for actions")
            : String(localized: "Reply to Draggy")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !model.pendingImages.isEmpty || !model.pendingVideos.isEmpty { attachments }
            card
            if model.mode == .code, let project = model.activeProject { projectRow(project) }
        }
        .frame(maxWidth: 760)
        .padding(.horizontal, 20)
        .padding(.bottom, 14)
        .frame(maxWidth: .infinity)
        .fileImporter(isPresented: $isPickingFile, allowedContentTypes: Self.attachmentTypes) { result in
            if case let .success(url) = result { Task { await model.attach(url) } }
        }
        .task(id: model.activeProject) { await readBranch() }
        .task { model.models.refreshInstalled() }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 0) {
            TextField(placeholder, text: $model.draft, axis: .vertical)
                .textFieldStyle(.plain)
                .font(.ui(15))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1...8)
                .focused($isFocused)
                .onSubmit { send() }
                .padding(.horizontal, 16)
                .padding(.top, 14)
                .padding(.bottom, 6)
            HStack(spacing: 4) {
                addMenu
                if model.mode == .code { permissionMenu }
                Spacer(minLength: 8)
                if model.isTalking {
                    Text(model.talkPhase.label)
                        .font(.ui(12))
                        .foregroundStyle(Theme.textSecondary)
                }
                modelMenu
                IconButton(glyph: model.isTalking ? .microphoneSlash : .microphone,
                           label: String(localized: "Talk")) { model.toggleTalk() }
                    .disabled(model.isRunning && !model.isTalking)
                sendButton
            }
            .padding(.horizontal, 8)
            .padding(.bottom, 8)
        }
        .background(Theme.surfaceBase, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.lg)
                .strokeBorder(isFocused ? Theme.ruleStrong : Theme.rule)
        )
        .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .onTapGesture { isFocused = true }
    }

    private func send() {
        guard canSend, !model.isRunning else { return }
        Task { await model.send() }
    }

    /// The round button at the end of the row: an arrow to send, a square to stop a running reply.
    private var sendButton: some View {
        let running = model.isRunning
        let active = running || canSend
        return Button {
            if running { model.stop() } else { send() }
        } label: {
            ZStack {
                Circle().fill(active ? model.appearance.accent.color(\.base) : Theme.surfaceRaised)
                Icon(glyph: running ? .stop : .arrowUp, size: 14, filled: running)
                    .foregroundStyle(active ? model.appearance.accent.color(\.text) : Theme.textTertiary)
            }
            .frame(width: 28, height: 28)
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(!active)
        .keyboardShortcut(running ? .cancelAction : KeyboardShortcut(.return, modifiers: .command))
        .help(running ? String(localized: "Stop") : String(localized: "Send"))
        .accessibilityLabel(running ? String(localized: "Stop") : String(localized: "Send"))
    }

    /// The + menu: files to add, and reading replies aloud, which had its own button before.
    private var addMenu: some View {
        Menu {
            Button("Add files") { isPickingFile = true }
                .disabled(model.isRunning)
            Toggle("Read replies aloud", isOn: $model.speakReplies)
        } label: {
            Icon(glyph: .plus, size: 16)
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .help("Add context")
        .accessibilityLabel("Add context")
    }

    private var permissionMenu: some View {
        Menu {
            Picker("Permissions", selection: $model.permission) {
                ForEach(PermissionChoice.allCases) { choice in
                    Text(Self.chipTitle(choice)).tag(choice)
                }
            }
            .pickerStyle(.inline)
        } label: {
            ChipLabel(title: Self.chipTitle(model.permission))
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .disabled(model.isRunning)
    }

    /// The short names the Windows picker shows, in place of the longer settings titles.
    static func chipTitle(_ choice: PermissionChoice) -> String {
        switch choice {
        case .plan: String(localized: "Plan only")
        case .ask: String(localized: "Ask first")
        case .acceptEdits: String(localized: "Accept edits")
        }
    }

    private var modelName: String {
        let name = model.modelName.isEmpty ? model.engine.modelPath : model.modelName
        guard !name.isEmpty else { return String(localized: "No model") }
        let file = URL(fileURLWithPath: name).deletingPathExtension().lastPathComponent
        return file.isEmpty ? name : file
    }

    private var modelMenu: some View {
        Button {
            isChoosingModel.toggle()
        } label: {
            ChipLabel(glyph: .cpu, title: modelName)
        }
        .buttonStyle(.plain)
        .disabled(model.isRunning)
        .help("Model")
        .popover(isPresented: $isChoosingModel, arrowEdge: .top) {
            ModelChoices(model: model) { installed in
                isChoosingModel = false
                use(installed)
            } manageModels: {
                isChoosingModel = false
                model.isShowingModels = true
            } openSettings: {
                isChoosingModel = false
                openSettings()
            }
        }
    }

    /// Points the engine at the model and loads it, as the Start button in Settings does.
    private func use(_ installed: InstalledModelRecord) {
        model.models.use(installed)
        Task {
            if model.engine.isRunning { await model.engine.stop() }
            await model.engine.start()
        }
    }

    private var attachments: some View {
        HStack(spacing: 6) {
            ForEach(Array(model.pendingImages.enumerated()), id: \.offset) { index, image in
                AttachmentPill(glyph: .image, name: image.name) { model.removeImage(at: index) }
            }
            ForEach(Array(model.pendingVideos.enumerated()), id: \.offset) { index, video in
                AttachmentPill(glyph: .filmStrip, name: video.name) { model.removeVideo(at: index) }
            }
        }
        .padding(.horizontal, 4)
    }

    private func projectRow(_ project: String) -> some View {
        HStack(spacing: 6) {
            ChipLabel(glyph: .folderSimple, title: URL(fileURLWithPath: project).lastPathComponent, caret: false)
                .help(project)
            if let branch {
                ChipLabel(glyph: .gitBranch, title: branch, caret: false)
            }
        }
        .padding(.horizontal, 4)
    }

    private func readBranch() async {
        guard model.mode == .code, let project = model.activeProject,
              FileManager.default.fileExists(atPath: (project as NSString).appendingPathComponent(".git"))
        else {
            branch = nil
            return
        }
        let name = await Task.detached { GitOperations.shared.currentBranch(in: project) }.value
        branch = name == "HEAD" ? nil : name
    }
}

/// A Windows chip: a pill with an icon, a label and a dropdown caret.
struct ChipLabel: View {
    var glyph: Glyph?
    let title: String
    var caret = true
    @State private var isHovered = false

    var body: some View {
        HStack(spacing: 6) {
            if let glyph {
                Icon(glyph: glyph, size: 14)
                    .foregroundStyle(Theme.textSecondary)
            }
            Text(Self.shortened(title))
                .lineLimit(1)
            if caret {
                Icon(glyph: .caretDown, size: 12)
                    .foregroundStyle(Theme.textTertiary)
            }
        }
        .font(.ui(13, .medium))
        .foregroundStyle(Theme.textPrimary)
        .padding(.horizontal, 10)
        .frame(height: 28)
        .fixedSize()
        .background(isHovered ? Theme.surfaceRaised : Theme.surfaceBase, in: Capsule())
        .overlay(Capsule().strokeBorder(Theme.rule))
        .contentShape(Capsule())
        .onHover { isHovered = $0 }
    }

    /// Long model and folder names lose their middle, so the chip keeps to its content's width.
    static func shortened(_ title: String, limit: Int = 32) -> String {
        guard title.count > limit else { return title }
        let keep = (limit - 1) / 2
        return String(title.prefix(keep)) + "\u{2026}" + String(title.suffix(keep))
    }
}

/// A picture or video waiting to go with the next message.
private struct AttachmentPill: View {
    let glyph: Glyph
    let name: String
    let remove: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            Icon(glyph: glyph, size: 14)
                .foregroundStyle(Theme.textSecondary)
            Text(name)
                .lineLimit(1)
                .frame(maxWidth: 180, alignment: .leading)
            Button(action: remove) {
                Icon(glyph: .x, size: 12)
                    .foregroundStyle(Theme.textSecondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove")
        }
        .font(.ui(13))
        .padding(.horizontal, 10)
        .frame(height: 28)
        .background(Theme.surfaceBase, in: Capsule())
        .overlay(Capsule().strokeBorder(Theme.rule))
    }
}

/// The Windows model popover: the engine's models, the provider in use, a search once the list is long,
/// and the two ways into settings at the bottom.
private struct ModelChoices: View {
    @Bindable var model: AppModel
    let choose: (InstalledModelRecord) -> Void
    let manageModels: () -> Void
    let openSettings: () -> Void
    @State private var query = ""

    /// A provider is in use when the engine is not answering and a model name is set.
    private var providerModel: String? {
        model.engine.isRunning || model.modelName.isEmpty ? nil : model.modelName
    }

    var body: some View {
        let installed = model.models.installed.filter {
            query.isEmpty || $0.filename.localizedCaseInsensitiveContains(query)
        }
        VStack(alignment: .leading, spacing: 8) {
            if model.models.installed.count + (providerModel == nil ? 0 : 1) > 8 {
                HStack(spacing: 6) {
                    Icon(glyph: .magnifyingGlass, size: 12)
                        .foregroundStyle(Theme.textSecondary)
                    TextField("Search models...", text: $query)
                        .textFieldStyle(.plain)
                        .font(.ui(11, .medium))
                }
                .padding(.horizontal, 8)
                .frame(height: 26)
                .overlay(RoundedRectangle(cornerRadius: Theme.Radius.xs).strokeBorder(Theme.ruleControl))
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    if providerModel != nil {
                        header(Text("Draggy"), mark: true)
                    }
                    if installed.isEmpty {
                        Text("No models installed")
                            .font(.ui(12))
                            .foregroundStyle(Theme.textSecondary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                    }
                    ForEach(installed, id: \.path) { file in
                        row(ModelsView.name(file), current: model.engine.modelPath == file.path) { choose(file) }
                    }
                    if let providerModel {
                        header(Text(verbatim: URL(string: model.baseURL)?.host() ?? model.baseURL), mark: false)
                        row(providerModel, current: true) {}
                    }
                }
            }
            .frame(maxHeight: 224)
            Rectangle().fill(Theme.rule).frame(height: 1).padding(.horizontal, -8)
            HStack(spacing: 4) {
                footerButton(glyph: .cpu, title: String(localized: "Manage models"), action: manageModels)
                footerButton(glyph: .plug, title: String(localized: "Providers"), action: openSettings)
            }
        }
        .padding(8)
        .frame(width: 288)
        .background(Theme.surfaceBase)
        .task { model.models.refreshInstalled() }
    }

    private func header(_ title: Text, mark: Bool) -> some View {
        HStack(spacing: 6) {
            if mark { DragonMark(size: 12) }
            title
        }
        .font(.ui(12, .medium))
        .foregroundStyle(Theme.textSecondary)
        .padding(.horizontal, 8)
        .padding(.top, 6)
        .padding(.bottom, 2)
    }

    private func row(_ name: String, current: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(name)
                    .font(.ui(13, .medium))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 6)
                if current {
                    Icon(glyph: .check, size: 14)
                        .foregroundStyle(Theme.textPrimary)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(current ? Theme.surfaceTint : .clear, in: RoundedRectangle(cornerRadius: Theme.Radius.xs))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(current ? .isSelected : [])
    }

    private func footerButton(glyph: Glyph, title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Icon(glyph: glyph, size: 12)
                Text(title)
            }
            .font(.ui(11))
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(RowButtonStyle())
    }
}
