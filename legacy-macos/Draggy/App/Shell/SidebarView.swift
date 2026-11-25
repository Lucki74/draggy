import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// The Windows sidebar: mode switch, navigation rows, sessions by date or by project, then Settings.
struct SidebarView: View {
    @Bindable var model: AppModel
    @Bindable var shell: ShellState
    @AppStorage("sessionGrouping") private var grouping = SessionGrouping.date
    @AppStorage("sessionSorting") private var sorting = SessionSorting.activity
    @State private var renaming: UUID?
    @State private var renameDraft = ""
    @State private var pendingDelete: SessionRow?
    @State private var collapsed: Set<String> = []

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 8) {
                ModeSwitch(mode: model.mode, isEnabled: !model.isRunning) { next in
                    model.switchMode(next)
                    shell.page = .chat
                }
                VStack(spacing: 2) {
                    NavRow(glyph: .plus, title: newTitle, shortcut: "⌘N", action: startNew)
                        .disabled(model.isRunning)
                    NavRow(glyph: .magnifyingGlass, title: String(localized: "Search"), shortcut: "⌘K") {
                        shell.isSearching = true
                    }
                    if model.mode == .chat {
                        NavRow(glyph: .waveform, title: String(localized: "Talk")) {
                            shell.page = .chat
                            if !model.isTalking { model.toggleTalk() }
                        }
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 12)
            .padding(.bottom, 4)

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if model.mode == .chat { chatSessions } else { projectList }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 8)
            }
            .scrollIndicators(.automatic)

            Rectangle().fill(Theme.rule).frame(height: 1)
            SettingsLink {
                HStack(spacing: 10) {
                    Icon(glyph: .gearSix, size: 16)
                        .foregroundStyle(Theme.textSecondary)
                    Text("Settings")
                    Spacer()
                    Text(verbatim: "⌘,")
                        .font(.ui(11))
                        .foregroundStyle(Theme.textTertiary)
                }
                .padding(.horizontal, 8)
                .frame(height: 36)
                .contentShape(Rectangle())
            }
            .buttonStyle(RowButtonStyle())
            .padding(8)
        }
        .background(Theme.surfaceCanvas)
        .alert(
            "Delete this session?",
            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            presenting: pendingDelete
        ) { row in
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) { model.delete(row.id) }
        } message: { row in
            Text("\"\(row.title)\" and its messages will be removed. This can't be undone.")
        }
    }

    private var newTitle: String {
        guard model.mode == .code else { return String(localized: "New chat") }
        return model.projects.isEmpty ? String(localized: "New project") : String(localized: "New session")
    }

    private func startNew() {
        shell.page = .chat
        if model.mode == .code, model.projects.isEmpty {
            pickProject()
        } else {
            model.newConversation()
        }
    }

    private func pickProject() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = String(localized: "Open folder")
        guard panel.runModal() == .OK, let url = panel.url else { return }
        model.addProject(url)
        shell.page = .chat
    }

    // MARK: Chat

    @ViewBuilder
    private var chatSessions: some View {
        let sections = SessionArrangement.sections(model.sessionRows, grouping: grouping, sorting: sorting)
        if sections.isEmpty {
            HStack {
                Spacer()
                viewMenu
            }
            VStack(spacing: 8) {
                Text("No chats yet")
                    .font(.ui(12))
                    .foregroundStyle(Theme.textSecondary)
                Button {
                    startNew()
                } label: {
                    HStack(spacing: 4) {
                        Icon(glyph: .plus, size: 12)
                        Text("New chat")
                    }
                    .font(.ui(12, .medium))
                    .foregroundStyle(Theme.textPrimary)
                }
                .buttonStyle(.plain)
            }
            .frame(maxWidth: .infinity)
            .padding(16)
        }
        ForEach(Array(sections.enumerated()), id: \.element.id) { index, section in
            VStack(alignment: .leading, spacing: 2) {
                if !section.label.isEmpty || index == 0 {
                    HStack(spacing: 4) {
                        Text(section.label)
                            .font(.ui(12, .medium))
                            .foregroundStyle(Theme.textTertiary)
                            .lineLimit(1)
                        Spacer(minLength: 4)
                        if index == 0 { viewMenu }
                    }
                    .padding(.leading, 8)
                    .frame(height: 22)
                }
                ForEach(section.rows) { row in sessionRow(row) }
            }
        }
    }

    /// The grouping and order of chats, behind the sliders icon as on Windows.
    private var viewMenu: some View {
        Menu {
            Picker("Group by", selection: $grouping) {
                Text("Date").tag(SessionGrouping.date)
                Text("None").tag(SessionGrouping.none)
            }
            .pickerStyle(.inline)
            Picker("Sort by", selection: $sorting) {
                Text("Last activity").tag(SessionSorting.activity)
                Text("Title").tag(SessionSorting.title)
            }
            .pickerStyle(.inline)
        } label: {
            Icon(glyph: .slidersHorizontal, size: 14)
                .foregroundStyle(Theme.textTertiary)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .help("View options")
        .accessibilityLabel("View options")
    }

    // MARK: Code

    /// The Projects header menu: adding a folder, then the order of sessions inside each project.
    private var projectMenu: some View {
        Menu {
            Button("Add folder", action: pickProject)
                .disabled(model.isRunning)
            Picker("Sort by", selection: $sorting) {
                Text("Last activity").tag(SessionSorting.activity)
                Text("Title").tag(SessionSorting.title)
            }
            .pickerStyle(.inline)
        } label: {
            Icon(glyph: .slidersHorizontal, size: 14)
                .foregroundStyle(Theme.textTertiary)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .help("View options")
        .accessibilityLabel("View options")
    }

    @ViewBuilder
    private var projectList: some View {
        HStack(spacing: 4) {
            Text("Projects")
                .font(.ui(12, .medium))
                .foregroundStyle(Theme.textTertiary)
            Spacer()
            projectMenu
        }
        .padding(.leading, 8)
        .frame(height: 22)
        if model.projects.isEmpty {
            Button(action: pickProject) {
                HStack(spacing: 4) {
                    Icon(glyph: .folderSimplePlus, size: 12)
                    Text("Open a folder")
                }
                .font(.ui(12, .medium))
                .foregroundStyle(Theme.textPrimary)
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity)
            .padding(16)
        }
        let rows = SessionArrangement.sorted(model.sessionRows, by: sorting)
        ForEach(model.projects, id: \.self) { path in
            projectSection(path, rows: rows.filter { $0.project == path })
        }
    }

    private func projectSection(_ path: String, rows: [SessionRow]) -> some View {
        let isCollapsed = collapsed.contains(path)
        let isActive = model.activeProject == path
        return VStack(alignment: .leading, spacing: 2) {
            ProjectHeader(
                name: URL(fileURLWithPath: path).lastPathComponent,
                path: path,
                isActive: isActive,
                isCollapsed: isCollapsed,
                isEnabled: !model.isRunning,
                onToggle: {
                    if isCollapsed { collapsed.remove(path) } else { collapsed.insert(path) }
                },
                onNewSession: {
                    shell.page = .chat
                    model.selectProject(path)
                },
                onRemove: { model.removeProject(path) }
            )
            if !isCollapsed {
                VStack(alignment: .leading, spacing: 2) {
                    if rows.isEmpty {
                        Text("No chats yet")
                            .font(.ui(11))
                            .foregroundStyle(Theme.textTertiary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                    }
                    ForEach(rows) { row in sessionRow(row) }
                }
                .padding(.leading, 12)
                .overlay(alignment: .leading) {
                    Rectangle().fill(Theme.rule).frame(width: 1)
                }
                .padding(.leading, 8)
            }
        }
    }

    // MARK: Rows

    private func sessionRow(_ row: SessionRow) -> some View {
        let isCurrent = row.id == model.currentConversationID
        return SessionRowView(
            row: row,
            isCurrent: isCurrent,
            isRunning: isCurrent && model.isRunning,
            needsApproval: isCurrent && model.pendingApproval != nil,
            isEditing: renaming == row.id,
            draft: $renameDraft,
            accent: model.appearance.accent,
            onOpen: {
                shell.page = .chat
                model.open(row.id)
            },
            onRename: {
                renameDraft = row.title
                renaming = row.id
            },
            onCommitRename: {
                model.rename(row.id, to: renameDraft)
                renaming = nil
            },
            onCancelRename: { renaming = nil },
            onPin: { model.togglePin(row.id) },
            onExport: { export(row) },
            onDelete: { pendingDelete = row }
        )
        .disabled(model.isRunning && !isCurrent)
    }

    private func export(_ row: SessionRow) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "\(row.title.replacingOccurrences(of: "/", with: "-")).md"
        panel.allowedContentTypes = [.init(filenameExtension: "md") ?? .plainText]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try model.markdown(for: row.id).write(to: url, atomically: true, encoding: .utf8)
        } catch {
            model.report(String(localized: "The conversation could not be saved."))
        }
    }
}

/// One project in Code: caret, folder and name, with new-session and actions buttons on hover.
private struct ProjectHeader: View {
    let name: String
    let path: String
    let isActive: Bool
    let isCollapsed: Bool
    let isEnabled: Bool
    let onToggle: () -> Void
    let onNewSession: () -> Void
    let onRemove: () -> Void
    @State private var isHovered = false

    var body: some View {
        HStack(spacing: 4) {
            Button(action: onToggle) {
                HStack(spacing: 6) {
                    Icon(glyph: isCollapsed ? .caretRight : .caretDown, size: 12)
                        .foregroundStyle(Theme.textTertiary)
                    Icon(glyph: .folderSimple, size: 14)
                    Text(name)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer(minLength: 0)
                }
                .font(.ui(12, .semibold))
                .foregroundStyle(isActive || isHovered ? Theme.textPrimary : Theme.textSecondary)
                .padding(.leading, 6)
                .frame(height: 28)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(path)

            if isHovered {
                IconButton(glyph: .plus, label: String(localized: "New chat in this project"), size: 12,
                           action: onNewSession)
                    .disabled(!isEnabled)
                Menu {
                    Button("New chat in this project", action: onNewSession)
                    Button("Show in Finder") {
                        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
                    }
                    Divider()
                    Button("Remove project", role: .destructive, action: onRemove)
                } label: {
                    Icon(glyph: .dotsThree, size: 12)
                        .foregroundStyle(Theme.textSecondary)
                }
                .menuStyle(.button)
                .buttonStyle(.plain)
                .menuIndicator(.hidden)
                .fixedSize()
                .disabled(!isEnabled)
                .accessibilityLabel("Project actions")
                .padding(.trailing, 4)
            }
        }
        .background(isHovered ? Theme.surfaceRaised.opacity(0.4) : .clear,
                    in: RoundedRectangle(cornerRadius: Theme.Radius.sm))
        .onHover { isHovered = $0 }
    }
}

/// A conversation in the sidebar: status mark, title, and an actions menu on hover or right click.
private struct SessionRowView: View {
    let row: SessionRow
    let isCurrent: Bool
    let isRunning: Bool
    let needsApproval: Bool
    let isEditing: Bool
    @Binding var draft: String
    let accent: Accent
    let onOpen: () -> Void
    let onRename: () -> Void
    let onCommitRename: () -> Void
    let onCancelRename: () -> Void
    let onPin: () -> Void
    let onExport: () -> Void
    let onDelete: () -> Void
    @State private var isHovered = false
    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(spacing: 0) {
            if isEditing {
                TextField("Rename", text: $draft)
                    .textFieldStyle(.plain)
                    .font(.ui(12))
                    .padding(.horizontal, 4)
                    .padding(.vertical, 2)
                    .background(Theme.surfaceBase, in: RoundedRectangle(cornerRadius: Theme.Radius.xs))
                    .overlay(RoundedRectangle(cornerRadius: Theme.Radius.xs).strokeBorder(Theme.ruleControl))
                    .padding(.horizontal, 6)
                    .focused($isFocused)
                    .onAppear { isFocused = true }
                    .onSubmit(onCommitRename)
                    .onExitCommand(perform: onCancelRename)
                    .onChange(of: isFocused) { _, focused in
                        if !focused { onCommitRename() }
                    }
            } else {
                Button(action: onOpen) {
                    HStack(spacing: 8) {
                        status
                            .frame(width: 14, height: 14)
                        Text(row.title.isEmpty ? String(localized: "New chat") : row.title)
                            .lineLimit(1)
                            .truncationMode(.tail)
                        Spacer(minLength: 0)
                    }
                    .padding(.leading, 10)
                    .padding(.trailing, 4)
                    .frame(height: 32)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isCurrent ? .isSelected : [])

                Menu {
                    actions
                } label: {
                    Icon(glyph: .dotsThree, size: 14)
                        .foregroundStyle(Theme.textSecondary)
                }
                .menuStyle(.button)
                .buttonStyle(.plain)
                .menuIndicator(.hidden)
                .fixedSize()
                .padding(.trailing, 6)
                .opacity(isHovered ? 1 : 0)
                .accessibilityLabel("Session actions")
            }
        }
        .font(.ui(13))
        .foregroundStyle(Theme.textPrimary)
        .background(fill, in: RoundedRectangle(cornerRadius: Theme.Radius.sm))
        .onHover { isHovered = $0 }
        .contextMenu { actions }
    }

    private var fill: Color {
        if isCurrent { return Theme.surfaceRaised }
        return isHovered ? Theme.surfaceRaised.opacity(0.6) : .clear
    }

    @ViewBuilder
    private var status: some View {
        if isRunning {
            Circle()
                .fill(accent.color(\.base))
                .frame(width: 7, height: 7)
                .phaseAnimator([0.35, 1]) { dot, phase in dot.opacity(phase) }
                .accessibilityLabel("Working")
        } else if needsApproval {
            Circle()
                .fill(Theme.warn)
                .frame(width: 7, height: 7)
                .accessibilityLabel("Needs your approval")
        } else if row.pinned {
            Icon(glyph: .pushPin, size: 12, filled: true)
                .foregroundStyle(Theme.textTertiary)
                .accessibilityLabel("Pinned")
        }
    }

    @ViewBuilder
    private var actions: some View {
        Button("Rename", action: onRename)
        Button(row.pinned ? "Unpin" : "Pin", action: onPin)
        Button("Export as Markdown (.md)", action: onExport)
        Divider()
        Button("Delete", role: .destructive, action: onDelete)
    }
}
