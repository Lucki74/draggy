import DraggyCore
import SwiftUI

/// The Windows ModelSearch: a search field over Hugging Face, capability chips to narrow it, and rows
/// that open onto their quantisations, each with a Download or Choose button.
struct ModelSearchView: View {
    @Bindable var models: ModelsModel
    /// "Download" in Settings, "Choose" in the setup.
    let actionTitle: String
    /// The reference already picked, shown pressed.
    var picked: String?
    let onPick: (String) -> Void
    @State private var filters: Set<String> = []
    @State private var expanded: Set<String> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Icon(glyph: .magnifyingGlass, size: 14)
                    .foregroundStyle(Theme.textSecondary)
                TextField("Search models...", text: $models.query)
                    .textFieldStyle(.plain)
                    .font(.ui(13))
                if models.isSearching {
                    ProgressView().controlSize(.small)
                }
            }
            .padding(.horizontal, 10)
            .frame(height: 32)
            .background(Theme.surfaceBase, in: RoundedRectangle(cornerRadius: Theme.Radius.sm))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.sm).strokeBorder(Theme.ruleControl))

            let capabilities = Self.order(Set(models.results.flatMap(\.capabilities)))
            if !capabilities.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(capabilities, id: \.self) { capability in
                            FilterChip(title: Self.title(capability), on: filters.contains(capability)) {
                                if filters.contains(capability) { filters.remove(capability) } else { filters.insert(capability) }
                            }
                        }
                    }
                    .padding(.horizontal, 1)
                }
            }

            let shown = models.results.filter { filters.isSubset(of: Set($0.capabilities)) }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if shown.isEmpty && !models.isSearching {
                        Text("No models found")
                            .font(.ui(13))
                            .foregroundStyle(Theme.textSecondary)
                            .padding(14)
                    }
                    ForEach(shown, id: \.name) { result in
                        resultRow(result)
                        if result.name != shown.last?.name {
                            Rectangle().fill(Theme.rule).frame(height: 1)
                        }
                    }
                }
            }
            .frame(maxHeight: 420)
            .background(Theme.surfaceBase, in: RoundedRectangle(cornerRadius: Theme.Radius.sm))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.sm).strokeBorder(Theme.rule))
        }
        .task(id: models.query) {
            // Searches once typing pauses, as the Windows field does after 350 ms.
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            await models.search()
        }
    }

    private func resultRow(_ result: LibraryModelRecord) -> some View {
        let open = expanded.contains(result.name)
        return VStack(alignment: .leading, spacing: 6) {
            Button {
                if open { expanded.remove(result.name) } else { expanded.insert(result.name) }
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(result.name)
                            .font(.ui(14, .medium))
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        if Self.isMLX(result) {
                            Text(verbatim: "MLX")
                                .font(.ui(11, .medium))
                                .foregroundStyle(Theme.warn)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 1)
                                .background(Theme.surfaceRaised, in: Capsule())
                        }
                        ForEach(Self.order(Set(result.capabilities)).prefix(4), id: \.self) { capability in
                            Text(Self.title(capability))
                                .font(.ui(11, .medium))
                                .foregroundStyle(Theme.textSecondary)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 1)
                                .background(Theme.surfaceRaised, in: Capsule())
                        }
                        Spacer(minLength: 4)
                        Icon(glyph: open ? .caretDown : .caretRight, size: 12)
                            .foregroundStyle(Theme.textTertiary)
                    }
                    if !result.description.isEmpty {
                        Text(result.description)
                            .font(.ui(12))
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open && Self.isMLX(result) {
                // Hugging Face files MLX builds under GGUF too; the engine here loads GGUF only.
                Text("This is an MLX model. Draggy downloads GGUF models, so pick a GGUF build of it instead.")
                    .font(.ui(12))
                    .foregroundStyle(Theme.textSecondary)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.surfaceTint, in: RoundedRectangle(cornerRadius: Theme.Radius.xs))
            } else if open {
                VStack(spacing: 4) {
                    ForEach(result.sizes, id: \.self) { tag in
                        variant(result.reference + ":" + tag)
                    }
                }
                .padding(.top, 2)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    private func variant(_ reference: String) -> some View {
        let isPicked = picked == reference
        let busy = models.downloading == reference
        return HStack(spacing: 8) {
            Text(reference)
                .font(.code(12))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 8)
            if busy {
                ProgressView().controlSize(.small)
            } else {
                Button(actionTitle) { onPick(reference) }
                    .buttonStyle(PillButtonStyle(prominent: isPicked))
                    .disabled(models.downloading != nil && actionTitle == String(localized: "Download"))
                    .accessibilityAddTraits(isPicked ? .isSelected : [])
            }
        }
        .padding(.horizontal, 10)
        .frame(height: 32)
        .background(Theme.surfaceTint, in: RoundedRectangle(cornerRadius: Theme.Radius.xs))
    }

    /// An MLX build, by the name its uploader gave it. The core refuses its download with the same reason.
    static func isMLX(_ result: LibraryModelRecord) -> Bool {
        (result.reference + " " + result.name).range(of: "mlx", options: .caseInsensitive) != nil
    }

    /// The capabilities Windows names, most useful first. Tags it has no name for, such as completion, stay hidden.
    private static let known = ["tools", "vision", "thinking", "embedding", "reranking", "image-generation",
                                "speech-recognition", "text-to-speech"]

    static func order(_ capabilities: Set<String>) -> [String] {
        known.filter(capabilities.contains)
    }

    static func title(_ capability: String) -> String {
        switch capability {
        case "tools": String(localized: "Tools")
        case "vision": String(localized: "Vision")
        case "thinking": String(localized: "Thinking")
        case "embedding": String(localized: "Embedding")
        case "reranking": String(localized: "Reranking")
        case "image-generation": String(localized: "Image generation")
        case "speech-recognition": String(localized: "Speech recognition")
        case "text-to-speech": String(localized: "Text to speech")
        default: capability
        }
    }
}

/// A capability filter: a pill that fills with the accent while it is on.
private struct FilterChip: View {
    let title: String
    let on: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.ui(12, .medium))
                .padding(.horizontal, 10)
                .frame(height: 28)
                .foregroundStyle(on ? Color(nsColor: Theme.NS.accent(\.text)) : Theme.textSecondary)
                .background(on ? Color(nsColor: Theme.NS.accent(\.base)) : Theme.surfaceBase, in: Capsule())
                .overlay(Capsule().strokeBorder(on ? .clear : Theme.rule))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// A small Windows button: outlined, or filled with the accent when it is the chosen one.
struct PillButtonStyle: ButtonStyle {
    var prominent = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.ui(12, .medium))
            .padding(.horizontal, 10)
            .frame(height: 24)
            .foregroundStyle(prominent ? Color(nsColor: Theme.NS.accent(\.text)) : Theme.textPrimary)
            .background(
                prominent ? Color(nsColor: Theme.NS.accent(\.base))
                    : configuration.isPressed ? Theme.surfaceRaised : Theme.surfaceBase,
                in: Capsule()
            )
            .overlay(Capsule().strokeBorder(prominent ? .clear : Theme.ruleControl))
            .contentShape(Capsule())
    }
}
