import AppKit
import DraggyCore
import SwiftUI

/// The first-run setup, laid out like win/src/onboarding: progress dots, one step in a 560 point
/// column, and Back, Skip and Continue along the bottom.
struct SetupView: View {
    @Bindable var model: AppModel
    @Bindable var setup: SetupModel

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                WindowChrome(barHeight: TitleBar.height)
                    .background(Theme.surfaceCanvas)
                progressDots
            }
            .frame(height: TitleBar.height)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    stepBody
                }
                .frame(maxWidth: 560, alignment: .leading)
                .padding(.horizontal, 24)
                .padding(.vertical, 32)
                .frame(maxWidth: .infinity)
                .id(setup.step)
                .transition(.opacity)
            }
            footer
        }
        .ignoresSafeArea(.container, edges: .top)
        .background(Theme.surfaceCanvas)
        .font(.ui(14))
        .foregroundStyle(Theme.textPrimary)
        .tint(model.appearance.accent.color(\.base))
        .frame(minWidth: 720, minHeight: 560)
        .alert("Skip setup?", isPresented: $setup.isConfirmingSkip) {
            Button("Cancel", role: .cancel) {}
            Button("Skip and continue") { setup.skip(model) }
        } message: {
            Text(skipBody)
        }
    }

    private var skipBody: String {
        if !model.models.installed.isEmpty {
            return String(localized: "Draggy will use the model already on this computer.")
        }
        let rung = setup.choice ?? ModelLadder.recommended(memoryGB: setup.memoryGB, chip: setup.chip)
        return String(format: String(localized: "Draggy will choose a model for your computer and download it, about %@."),
                      Self.size(rung.sizeBytes))
    }

    private var progressDots: some View {
        let all = setup.steps
        let current = all.firstIndex(of: setup.step) ?? 0
        return HStack(spacing: 6) {
            ForEach(Array(all.enumerated()), id: \.offset) { index, _ in
                Capsule()
                    .fill(index == current ? Theme.textPrimary : index < current ? Theme.textSecondary : Theme.ruleStrong)
                    .frame(width: index == current ? 20 : 6, height: 4)
            }
        }
        .animation(.easeOut(duration: 0.2), value: current)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Setup progress")
        .accessibilityValue(Text(verbatim: "\(current + 1) / \(all.count)"))
        .allowsHitTesting(false)
    }

    private var footer: some View {
        HStack(spacing: 8) {
            if setup.step != setup.steps.first {
                Button {
                    withAnimation(.easeOut(duration: 0.15)) { setup.back() }
                } label: {
                    HStack(spacing: 6) {
                        Icon(glyph: .arrowLeft, size: 14)
                        Text("Back")
                    }
                }
                .buttonStyle(SetupButtonStyle(kind: .secondary))
                .keyboardShortcut(.cancelAction)
            }
            Button("Skip setup") { setup.isConfirmingSkip = true }
                .buttonStyle(SetupButtonStyle(kind: .ghost))
            Spacer()
            if setup.step == .ready {
                Button("Start") { setup.finish(model) }
                    .buttonStyle(SetupButtonStyle(kind: .primary, accent: model.appearance.accent))
                    .disabled(!setup.canContinue(model))
                    .keyboardShortcut(.defaultAction)
            } else {
                Button("Continue") {
                    withAnimation(.easeOut(duration: 0.15)) { setup.next(model) }
                }
                .buttonStyle(SetupButtonStyle(kind: .primary, accent: model.appearance.accent))
                .disabled(!setup.canContinue(model))
                .keyboardShortcut(.defaultAction)
            }
        }
        .frame(maxWidth: 560)
        .padding(.horizontal, 24)
        .padding(.vertical, 20)
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var stepBody: some View {
        switch setup.step {
        case .welcome: welcome
        case .appearance: appearance
        case .source: source
        case .local: local
        case .provider: provider
        case .preferences: preferences
        case .ready: ready
        }
    }

    // MARK: Steps

    private var welcome: some View {
        VStack(spacing: 0) {
            DragonMark(size: 80)
                .foregroundStyle(Theme.textPrimary)
            Text("Welcome to Draggy")
                .font(.ui(44, .semibold))
                .multilineTextAlignment(.center)
                .padding(.top, 32)
            Text("Draggy runs AI on your own computer. Let's set it up.")
                .font(.ui(15))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)
                .padding(.top, 12)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 48)
    }

    private var appearance: some View {
        VStack(alignment: .leading, spacing: 28) {
            StepHeader(title: String(localized: "How should Draggy look?"))
            AppearanceControls(appearance: model.appearance)
        }
    }

    private var source: some View {
        let rung = setup.choice ?? ModelLadder.recommended(memoryGB: setup.memoryGB, chip: setup.chip)
        let download = String(format: String(localized: "Needs a download of about %@."), Self.size(rung.sizeBytes))
        let weak = rung.kind == .dense && rung.memory < 3
        return VStack(alignment: .leading, spacing: 24) {
            StepHeader(title: String(localized: "Where should the AI run?"))
            VStack(spacing: 10) {
                SetupChoice(
                    title: String(localized: "On this computer"),
                    body: [String(localized: "Private and free, and it works offline once the model is downloaded."),
                           model.models.installed.isEmpty ? download : nil,
                           weak ? String(localized: "Small models on this computer will be basic.") : nil]
                        .compactMap { $0 }.joined(separator: " "),
                    selected: setup.path == .local
                ) { setup.path = .local }
                SetupChoice(
                    title: String(localized: "A provider or another app"),
                    body: String(localized: "Use OpenAI, Anthropic, Google and others with your own API key, or a server you already run, such as Ollama or LM Studio.")
                        + " " + String(localized: "A cloud provider receives your conversations and the files the model reads."),
                    selected: setup.path == .provider
                ) { setup.path = .provider }
                SetupChoice(
                    title: String(localized: "Both"),
                    body: String(localized: "Draggy's own model for everyday use, and a provider when you want one."),
                    selected: setup.path == .both
                ) { setup.path = .both }
            }
        }
    }

    private var local: some View {
        let options = ModelLadder.options(memoryGB: setup.memoryGB, chip: setup.chip)
        let memory = String(format: String(localized: "%@ unified memory"),
                            "\(Int(setup.memoryGB.rounded())) GB")
        let hardware = [setup.chip.isEmpty ? nil : setup.chip, memory].compactMap { $0 }.joined(separator: " \u{00B7} ")
        let smallest = ModelLadder.rungs[0]
        return VStack(alignment: .leading, spacing: 20) {
            StepHeader(title: String(localized: "Choose a model"))
            Text(hardware)
                .font(.ui(13))
                .foregroundStyle(Theme.textTertiary)
            VStack(spacing: 10) {
                ForEach(model.models.installed, id: \.path) { installed in
                    SetupChoice(
                        title: URL(fileURLWithPath: installed.filename).deletingPathExtension().lastPathComponent,
                        badge: String(localized: "On this computer"),
                        body: Self.size(Int64(installed.bytes)),
                        selected: setup.installedChoice?.path == installed.path
                    ) {
                        setup.installedChoice = installed
                    }
                }
                if let stronger = options.stronger {
                    rungChoice(stronger, badge: nil, note: String(localized: "Smarter, needs more memory"))
                }
                rungChoice(options.pick, badge: String(localized: "Recommended"), note: nil)
                if let lighter = options.lighter {
                    rungChoice(lighter, badge: nil, note: String(localized: "Faster, lighter"))
                }
            }
            if let searched = setup.choice, searched.memory == 0, setup.installedChoice == nil {
                SetupChoice(title: searched.reference, selected: true) {}
            }
            if !setup.fitsOnDisk(smallest) {
                Notice(text: String(format: String(localized: "There is not enough free space for any model. The smallest needs %@."),
                                    Self.size(smallest.sizeBytes)))
            }
            if setup.online == false {
                OfflineNotice { setup.checkOnline() }
            }
            Button {
                withAnimation(.easeOut(duration: 0.15)) { setup.isSearchingHub.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Icon(glyph: .caretRight, size: 12)
                        .rotationEffect(.degrees(setup.isSearchingHub ? 90 : 0))
                    Text("Search Hugging Face for another model")
                }
                .font(.ui(13))
                .foregroundStyle(Theme.textSecondary)
            }
            .buttonStyle(.plain)
            .disabled(setup.online == false)
            if setup.isSearchingHub {
                ModelSearchView(models: model.models, actionTitle: String(localized: "Choose"),
                                picked: setup.choice?.reference) { setup.chooseSearched($0) }
            }
        }
    }

    private func rungChoice(_ rung: ModelRung, badge: String?, note: String?) -> some View {
        let fits = setup.fitsOnDisk(rung)
        let detail = [note, rung.params, Self.size(rung.sizeBytes),
                      fits ? nil : String(format: String(localized: "Not enough free space: needs %@"), Self.size(rung.sizeBytes))]
            .compactMap { $0 }.joined(separator: " \u{00B7} ")
        return SetupChoice(
            title: rung.label,
            badge: badge,
            body: detail,
            selected: setup.installedChoice == nil && setup.choice == rung,
            disabled: !fits
        ) {
            setup.installedChoice = nil
            setup.choice = rung
        }
    }

    private var provider: some View {
        VStack(alignment: .leading, spacing: 24) {
            StepHeader(
                title: String(localized: "Connect a provider"),
                body: String(localized: "A server on this computer keeps everything here. A provider reached with a key receives your conversations and the files the model reads.")
            )
            ProviderGroup(title: String(localized: "On this computer")) {
                ForEach(setup.localServers, id: \.entry.id) { server in
                    ProviderRow(name: server.entry.name, detail: server.entry.chatURL ?? "",
                                selected: setup.providerID == server.entry.id) { setup.pickProvider(server.entry) }
                }
                HStack {
                    Text(setup.localServers.isEmpty && !setup.isScanning
                         ? String(localized: "No servers found on this computer.") : "")
                        .font(.ui(12))
                        .foregroundStyle(Theme.textTertiary)
                    Spacer()
                    if setup.isScanning { ProgressView().controlSize(.small) }
                    Button("Scan") { setup.scanServers() }
                        .buttonStyle(PillButtonStyle())
                        .disabled(setup.isScanning)
                }
                .padding(.horizontal, 14)
                .frame(height: 40)
            }
            ProviderGroup(title: String(localized: "API keys")) {
                ProviderPicker(selected: setup.providerID) { setup.pickProvider($0) }
            }
            if let entry = setup.selectedProvider, !entry.isLocal {
                VStack(alignment: .leading, spacing: 14) {
                    if entry.baseUrl == nil {
                        SetupField(label: String(localized: "Server address")) {
                            TextField(text: $setup.providerURL, prompt: Text(verbatim: "https://")) { EmptyView() }
                        }
                    }
                    SetupField(label: String(localized: "API key")) {
                        SecureField(text: $setup.providerKey, prompt: Text(verbatim: "sk-…")) { EmptyView() }
                    }
                    if let keyURL = entry.keyUrl.flatMap(URL.init(string:)) {
                        Link(destination: keyURL) {
                            HStack(spacing: 4) {
                                Text("Get a key")
                                Icon(glyph: .arrowSquareOut, size: 12)
                            }
                            .font(.ui(12, .medium))
                        }
                    }
                }
            }
            if setup.selectedProvider != nil {
                SetupField(label: String(localized: "Model to start with")) {
                    HStack {
                        TextField(text: $setup.providerModel, prompt: Text(verbatim: "model-id")) { EmptyView() }
                        if !setup.providerModels.isEmpty {
                            Menu {
                                ForEach(setup.providerModels, id: \.self) { name in
                                    Button(name) { setup.providerModel = name }
                                }
                            } label: {
                                Icon(glyph: .caretDown, size: 12)
                                    .foregroundStyle(Theme.textSecondary)
                            }
                            .menuStyle(.button)
                            .buttonStyle(.plain)
                            .menuIndicator(.hidden)
                            .fixedSize()
                        }
                    }
                }
            } else {
                Text("Switch a provider on and tick a model to start with.")
                    .font(.ui(13))
                    .foregroundStyle(Theme.textSecondary)
            }
            HStack(alignment: .top, spacing: 8) {
                Icon(glyph: .lockSimple, size: 14)
                    .foregroundStyle(Theme.textSecondary)
                Text("Keys stay on this computer, encrypted by your system's keystore. Draggy sends a key only to its own provider.")
                    .font(.ui(12))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var preferences: some View {
        VStack(alignment: .leading, spacing: 28) {
            StepHeader(title: String(localized: "A few preferences"))
            VStack(alignment: .leading, spacing: 10) {
                FieldLabel(text: String(localized: "Start in"))
                HStack(spacing: 8) {
                    SetupChoice(title: String(localized: "Chat"), selected: setup.startMode == .chat, compact: true) {
                        setup.startMode = .chat
                    }
                    SetupChoice(title: String(localized: "Code"), selected: setup.startMode == .code, compact: true) {
                        setup.startMode = .code
                    }
                }
            }
            VStack(alignment: .leading, spacing: 10) {
                FieldLabel(text: String(localized: "When Draggy works in your projects"))
                VStack(spacing: 8) {
                    ForEach(PermissionChoice.allCases) { choice in
                        SetupChoice(title: ComposerView.chipTitle(choice), body: choice.title,
                                    selected: model.permission == choice) {
                            model.permission = choice
                        }
                    }
                }
            }
        }
    }

    private var ready: some View {
        VStack(alignment: .leading, spacing: 24) {
            StepHeader(title: String(localized: "Ready"))
            VStack(spacing: 0) {
                summaryRow(String(localized: "Theme"), model.appearance.theme.title, step: .appearance)
                if setup.path != .provider {
                    summaryRow(String(localized: "Model"), setup.installedChoice.map {
                        URL(fileURLWithPath: $0.filename).deletingPathExtension().lastPathComponent
                    } ?? setup.choice?.label ?? "", step: .local)
                }
                if setup.path != .local {
                    summaryRow(String(localized: "Providers"), setup.providerModel, step: .provider)
                }
                summaryRow(String(localized: "Start in"),
                           setup.startMode == .code ? String(localized: "Code") : String(localized: "Chat"),
                           step: .preferences, last: true)
            }
            .background(Theme.surfaceBase, in: RoundedRectangle(cornerRadius: Theme.Radius.md))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.md).strokeBorder(Theme.rule))

            if setup.downloadsStarted {
                VStack(alignment: .leading, spacing: 14) {
                    ProgressRow(
                        title: String(localized: "Setting up the AI engine"),
                        fraction: model.engine.installPercent.map { $0 / 100 },
                        done: !model.engine.binaryPath.isEmpty,
                        error: model.engine.installError,
                        accent: model.appearance.accent
                    )
                    if setup.installedChoice == nil, let rung = setup.choice {
                        ProgressRow(
                            title: rung.label,
                            fraction: model.models.progress.map { $0.percent / 100 },
                            done: !model.engine.modelPath.isEmpty && model.models.downloading == nil,
                            error: model.models.errorMessage,
                            accent: model.appearance.accent
                        )
                    }
                }
                if model.engine.modelPath.isEmpty || model.engine.binaryPath.isEmpty {
                    Text("You can start now. Messages can be sent as soon as the download has finished.")
                        .font(.ui(13))
                        .foregroundStyle(Theme.textSecondary)
                }
            }
        }
    }

    private func summaryRow(_ label: String, _ value: String, step: SetupModel.Step, last: Bool = false) -> some View {
        Button {
            withAnimation(.easeOut(duration: 0.15)) { setup.step = step }
        } label: {
            HStack {
                Text(label)
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
                Text(value)
                    .lineLimit(1)
                Icon(glyph: .caretRight, size: 12)
                    .foregroundStyle(Theme.textTertiary)
            }
            .font(.ui(13))
            .padding(.horizontal, 16)
            .frame(height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .bottom) {
            if !last { Rectangle().fill(Theme.rule).frame(height: 1).padding(.horizontal, 16) }
        }
    }

    static func size(_ bytes: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }
}

// MARK: Pieces

private struct StepHeader: View {
    let title: String
    var body_: String?

    init(title: String, body: String? = nil) {
        self.title = title
        self.body_ = body
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.ui(22, .semibold))
            if let body_ {
                Text(body_)
                    .font(.ui(14))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct FieldLabel: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.ui(13, .medium))
            .foregroundStyle(Theme.textSecondary)
    }
}

/// A Windows setup card: radio mark, title with an optional badge, a quieter line under it.
private struct SetupChoice: View {
    let title: String
    var badge: String?
    var body_: String?
    let selected: Bool
    var disabled = false
    var compact = false
    let action: () -> Void
    @State private var isHovered = false

    init(title: String, badge: String? = nil, body: String? = nil, selected: Bool, disabled: Bool = false,
         compact: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.badge = badge
        self.body_ = body
        self.selected = selected
        self.disabled = disabled
        self.compact = compact
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 12) {
                Circle()
                    .strokeBorder(selected ? Theme.textPrimary : Theme.ruleControl, lineWidth: selected ? 5 : 1)
                    .frame(width: 16, height: 16)
                    .padding(.top, 2)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(title)
                            .font(.ui(compact ? 14 : 15, .medium))
                            .foregroundStyle(disabled ? Theme.textSecondary : Theme.textPrimary)
                            .lineLimit(1)
                        if let badge {
                            Text(badge)
                                .font(.ui(11, .medium))
                                .foregroundStyle(Theme.textSecondary)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 2)
                                .background(Theme.surfaceRaised, in: Capsule())
                        }
                    }
                    if let body_ {
                        Text(body_)
                            .font(.ui(13))
                            .foregroundStyle(Theme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .multilineTextAlignment(.leading)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, compact ? 12 : 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surfaceBase, in: RoundedRectangle(cornerRadius: Theme.Radius.md))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.md)
                    .strokeBorder(selected ? Theme.textPrimary : isHovered ? Theme.ruleControl : Theme.ruleStrong,
                                  lineWidth: selected ? 2 : 1)
            )
            .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.md))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .onHover { isHovered = $0 }
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

private struct SetupField<Field: View>: View {
    let label: String
    @ViewBuilder let field: () -> Field

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            FieldLabel(text: label)
            field()
                .textFieldStyle(.plain)
                .font(.ui(14))
                .padding(.horizontal, 12)
                .frame(height: 36)
                .background(Theme.surfaceBase, in: RoundedRectangle(cornerRadius: Theme.Radius.sm))
                .overlay(RoundedRectangle(cornerRadius: Theme.Radius.sm).strokeBorder(Theme.ruleControl))
                .accessibilityLabel(label)
        }
    }
}

private struct Notice: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Icon(glyph: .info, size: 16)
                .foregroundStyle(Theme.textSecondary)
            Text(text)
                .font(.ui(13))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Theme.Radius.md))
    }
}

/// The Windows offline notice: Hugging Face cannot be reached, with a way to try again.
private struct OfflineNotice: View {
    let retry: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Icon(glyph: .wifiSlash, size: 16)
                .foregroundStyle(Theme.textSecondary)
            Text("Hugging Face can't be reached, so no model can be downloaded yet.")
                .font(.ui(13))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            Button("Try again", action: retry)
                .buttonStyle(PillButtonStyle())
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Theme.surfaceRaised, in: RoundedRectangle(cornerRadius: Theme.Radius.md))
    }
}

/// A titled card of rows, as the Windows provider step groups its sources.
private struct ProviderGroup<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            FieldLabel(text: title)
            VStack(spacing: 0) { content() }
                .background(Theme.surfaceBase, in: RoundedRectangle(cornerRadius: Theme.Radius.md))
                .overlay(RoundedRectangle(cornerRadius: Theme.Radius.md).strokeBorder(Theme.rule))
        }
    }
}

private struct ProviderRow: View {
    let name: String
    let detail: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Circle()
                    .strokeBorder(selected ? Theme.textPrimary : Theme.ruleControl, lineWidth: selected ? 5 : 1)
                    .frame(width: 16, height: 16)
                VStack(alignment: .leading, spacing: 2) {
                    Text(name).font(.ui(14, .medium))
                    if !detail.isEmpty {
                        Text(detail).font(.code(11)).foregroundStyle(Theme.textTertiary).lineLimit(1)
                    }
                }
                Spacer()
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// The catalog's key providers in a searchable list, as the Windows AddProvider offers them.
private struct ProviderPicker: View {
    let selected: String?
    let pick: (ProviderEntry) -> Void
    @State private var query = ""

    var body: some View {
        let entries = ProviderCatalog.cloud.filter { query.isEmpty || $0.name.localizedCaseInsensitiveContains(query) }
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Icon(glyph: .magnifyingGlass, size: 14)
                    .foregroundStyle(Theme.textSecondary)
                TextField("Search providers...", text: $query)
                    .textFieldStyle(.plain)
                    .font(.ui(13))
            }
            .padding(.horizontal, 14)
            .frame(height: 40)
            Rectangle().fill(Theme.rule).frame(height: 1)
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(entries) { entry in
                        ProviderRow(name: entry.name, detail: entry.baseUrl ?? "", selected: selected == entry.id) {
                            pick(entry)
                        }
                    }
                }
            }
            .frame(height: 220)
        }
    }
}

/// One download on the Ready step: its name, a thin bar, and the percent or the error.
private struct ProgressRow: View {
    let title: String
    let fraction: Double?
    let done: Bool
    let error: String?
    let accent: Accent

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title)
                    .font(.ui(13, .medium))
                Spacer()
                if let error {
                    Text(error)
                        .font(.ui(12))
                        .foregroundStyle(Theme.danger)
                        .lineLimit(1)
                } else if done {
                    Icon(glyph: .checkCircle, size: 14, filled: true)
                        .foregroundStyle(Theme.ok)
                } else if let fraction {
                    Text(fraction, format: .percent.precision(.fractionLength(0)))
                        .font(.ui(12))
                        .foregroundStyle(Theme.textSecondary)
                        .monospacedDigit()
                }
            }
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.surfaceRaised)
                    Capsule()
                        .fill(accent.color(\.base))
                        .frame(width: geometry.size.width * (done ? 1 : min(max(fraction ?? 0, 0), 1)))
                }
            }
            .frame(height: 4)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The setup's buttons: a filled accent one to go on, an outlined one to go back, a plain one to skip.
private struct SetupButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary, ghost }
    let kind: Kind
    var accent: Accent = .vermilion

    func makeBody(configuration: Configuration) -> some View {
        StyledLabel(configuration: configuration, kind: kind, accent: accent)
    }

    private struct StyledLabel: View {
        let configuration: Configuration
        let kind: Kind
        let accent: Accent
        @Environment(\.isEnabled) private var isEnabled
        @State private var isHovered = false

        var body: some View {
            configuration.label
                .font(.ui(14, .medium))
                .foregroundStyle(foreground)
                .padding(.horizontal, 16)
                .frame(minWidth: kind == .primary ? 112 : nil)
                .frame(height: 36)
                .background(background, in: Capsule())
                .overlay(Capsule().strokeBorder(kind == .secondary ? Theme.ruleControl : .clear))
                .opacity(isEnabled ? 1 : 0.4)
                .contentShape(Capsule())
                .onHover { isHovered = $0 }
        }

        private var foreground: Color {
            switch kind {
            case .primary: accent.color(\.text)
            case .secondary: Theme.textPrimary
            case .ghost: isHovered ? Theme.textPrimary : Theme.textSecondary
            }
        }

        private var background: Color {
            switch kind {
            case .primary: configuration.isPressed ? accent.color(\.hover) : accent.color(\.base)
            case .secondary: isHovered ? Theme.surfaceRaised : Theme.surfaceBase
            case .ghost: isHovered ? Theme.surfaceRaised : .clear
            }
        }
    }
}
