import SwiftUI

/// The ⌘K palette: actions first, then every saved session whose title matches, newest first.
struct SearchPalette: View {
    @Bindable var model: AppModel
    @Bindable var shell: ShellState
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openSettings) private var openSettings
    @State private var query = ""
    @State private var selection = 0
    @FocusState private var isFocused: Bool

    private struct Entry: Identifiable {
        let id: String
        let glyph: Glyph
        let title: String
        var detail: String?
        let run: () -> Void
    }

    private var entries: [Entry] {
        let actions = [
            Entry(id: "new", glyph: .plus, title: String(localized: "New chat")) {
                shell.page = .chat
                model.newConversation()
            },
            Entry(id: "settings", glyph: .gearSix, title: String(localized: "Settings")) { openSettings() },
            Entry(id: "sidebar", glyph: .sidebarSimple,
                  title: shell.sidebarOpen ? String(localized: "Hide sidebar") : String(localized: "Show sidebar")) {
                shell.sidebarOpen.toggle()
            },
        ]
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        let matchingActions = trimmed.isEmpty ? actions : actions.filter { $0.title.localizedCaseInsensitiveContains(trimmed) }
        let sessions = SessionArrangement.sorted(model.allSessionRows, by: .activity)
            .filter { trimmed.isEmpty || $0.title.localizedCaseInsensitiveContains(trimmed) }
            .prefix(50)
            .map { row in
                Entry(id: row.id.uuidString, glyph: row.project == nil ? .chatCircle : .code, title: row.title,
                      detail: row.project.map { URL(fileURLWithPath: $0).lastPathComponent }) {
                    shell.page = .chat
                    model.open(row.id)
                }
            }
        return matchingActions + sessions
    }

    var body: some View {
        let list = entries
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Icon(glyph: .magnifyingGlass, size: 16)
                    .foregroundStyle(Theme.textSecondary)
                TextField("Type a command or search...", text: $query)
                    .textFieldStyle(.plain)
                    .font(.ui(14))
                    .focused($isFocused)
                    .onSubmit { run(list, at: selection) }
            }
            .padding(.horizontal, 14)
            .frame(height: 44)

            Rectangle().fill(Theme.rule).frame(height: 1)

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 2) {
                        if list.isEmpty {
                            Text("Nothing matches.")
                                .font(.ui(12))
                                .foregroundStyle(Theme.textSecondary)
                                .padding(16)
                        }
                        ForEach(Array(list.enumerated()), id: \.element.id) { index, entry in
                            Button {
                                run(list, at: index)
                            } label: {
                                HStack(spacing: 10) {
                                    Icon(glyph: entry.glyph, size: 16)
                                        .foregroundStyle(Theme.textSecondary)
                                    Text(entry.title)
                                        .lineLimit(1)
                                    Spacer(minLength: 8)
                                    if let detail = entry.detail {
                                        Text(detail)
                                            .font(.ui(11))
                                            .foregroundStyle(Theme.textTertiary)
                                            .lineLimit(1)
                                    }
                                }
                                .padding(.horizontal, 10)
                                .frame(height: 32)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(RowButtonStyle(isSelected: index == selection))
                            .id(index)
                        }
                    }
                    .padding(6)
                }
                .onChange(of: selection) { _, index in proxy.scrollTo(index) }
            }
        }
        .frame(width: 520, height: 380)
        .background(Theme.surfaceBase)
        .onAppear { isFocused = true }
        .onChange(of: query) { selection = 0 }
        .onKeyPress(.downArrow) {
            selection = min(selection + 1, max(list.count - 1, 0))
            return .handled
        }
        .onKeyPress(.upArrow) {
            selection = max(selection - 1, 0)
            return .handled
        }
        .onExitCommand { dismiss() }
    }

    private func run(_ list: [Entry], at index: Int) {
        guard list.indices.contains(index) else { return }
        dismiss()
        list[index].run()
    }
}
