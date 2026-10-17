import AppKit
import SwiftUI

struct SettingsView: View {
    @Bindable var model: AppModel
    @State private var keyDraft = ""

    var body: some View {
        Form {
            TextField("Server address", text: $model.baseURL)
            TextField("Model", text: $model.modelName)
            SecureField("API key", text: $keyDraft, prompt: Text(model.hasAPIKey() ? "Saved in the Keychain" : "None"))
            Button("Save key") {
                model.saveAPIKey(keyDraft)
                keyDraft = ""
            }
            .disabled(keyDraft.isEmpty)

            Section("Local engine") {
                pathRow("Engine program", path: model.engine.binaryPath, clear: { model.engine.binaryPath = "" }) {
                    model.engine.binaryPath = $0
                }
                pathRow("Model file", path: model.engine.modelPath, clear: { model.engine.modelPath = "" }) {
                    model.engine.modelPath = $0
                }
                HStack {
                    if model.engine.isRunning {
                        Button("Stop") { Task { await model.engine.stop() } }
                    } else {
                        Button("Start") { Task { await model.engine.start() } }
                            .disabled(model.engine.isBusy || model.engine.binaryPath.isEmpty || model.engine.modelPath.isEmpty)
                    }
                    Text(status(model.engine.phase)).foregroundStyle(.secondary).lineLimit(2)
                }
            }

            Section("Project") {
                LabeledContent("Folder") {
                    Text(model.folderPath.isEmpty ? "None" : model.folderPath)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.head)
                }
                HStack {
                    Button("Choose\u{2026}") { chooseFolder() }
                    Button("Clear") { model.folderPath = "" }
                        .disabled(model.folderPath.isEmpty)
                }
                Picker("Tool calls", selection: $model.permission) {
                    ForEach(PermissionChoice.allCases) { Text($0.title).tag($0) }
                }
                .disabled(model.folderPath.isEmpty)
                Toggle("Let the model run commands", isOn: $model.allowCommands)
                    .disabled(model.folderPath.isEmpty)
            }
        }
        .padding()
        .frame(width: 480)
    }

    private func pathRow(
        _ title: String, path: String, clear: @escaping () -> Void, choose: @escaping (String) -> Void
    ) -> some View {
        LabeledContent(title) {
            HStack {
                Text(path.isEmpty ? "None" : path)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.head)
                Button("Choose\u{2026}") { chooseFile { choose($0) } }
                Button("Clear", action: clear).disabled(path.isEmpty)
            }
        }
    }

    private func status(_ phase: EngineModel.Phase) -> String {
        switch phase {
        case .stopped: "Stopped"
        case .starting: "Starting\u{2026}"
        case let .running(name): "Running \(name)"
        case let .failed(message): message
        }
    }

    private func chooseFile(_ pick: (String) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Choose"
        if panel.runModal() == .OK, let url = panel.url { pick(url.path) }
    }

    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Choose"
        if panel.runModal() == .OK, let url = panel.url {
            model.folderPath = url.path
        }
    }
}
