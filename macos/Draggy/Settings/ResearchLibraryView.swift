import SwiftUI

/// The saved research runs behind Settings → Research: open one to read it, or delete it.
@MainActor
@Observable
final class ResearchLibraryModel {
    private let store: ResearchStore?
    var runs: [PastRunRecord] = []
    var opened: ResearchRunView?

    init(store: ResearchStore?) {
        self.store = store
    }

    func reload() {
        runs = (try? store?.listRuns(limit: 100)) ?? []
    }

    func open(_ id: String) {
        guard let store, let json = (try? store.runView(id: id)) ?? nil else { return }
        opened = ResearchRunView(json: json)
    }

    func remove(_ id: String) {
        try? store?.removeRun(id: id)
        reload()
    }
}

struct ResearchLibraryView: View {
    @State private var model: ResearchLibraryModel

    init(store: ResearchStore?) {
        _model = State(initialValue: ResearchLibraryModel(store: store))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Past research")
                .font(.headline)
            if model.runs.isEmpty {
                Text("No research yet. Ask a question that needs sources and the model starts one.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            ForEach(model.runs, id: \.id) { run in
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(run.question).lineLimit(2)
                        Text(Self.line(run))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Open") { model.open(run.id) }
                    Button("Delete", role: .destructive) { model.remove(run.id) }
                }
            }
        }
        .onAppear { model.reload() }
        .sheet(item: $model.opened) { run in
            ResearchRunSheet(run: run)
        }
    }

    private static func line(_ run: PastRunRecord) -> String {
        let depth = switch run.depth {
        case "quick": String(localized: "Quick")
        case "deep": String(localized: "Deep")
        default: String(localized: "Standard")
        }
        let date = Date(timeIntervalSince1970: Double(run.startedAt) / 1000).formatted(date: .abbreviated, time: .omitted)
        return [date, depth, String(localized: "\(Int(run.sourceCount)) sources read"), String(localized: "\(Int(run.noteCount)) notes")]
            .joined(separator: " · ")
    }
}

/// One saved run, drawn with the same card and source list the chat shows.
private struct ResearchRunSheet: View {
    let run: ResearchRunView
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .trailing) {
            ScrollView {
                Text(Self.text(run))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Button("Close") { dismiss() }
                .keyboardShortcut(.cancelAction)
        }
        .padding()
        .frame(minWidth: 480, minHeight: 360)
    }

    private static func text(_ run: ResearchRunView) -> AttributedString {
        let out = NSMutableAttributedString(attributedString: ResearchText.card(run))
        out.append(ResearchText.sourceList(run))
        return (try? AttributedString(out, including: \.appKit)) ?? AttributedString(out.string)
    }
}
