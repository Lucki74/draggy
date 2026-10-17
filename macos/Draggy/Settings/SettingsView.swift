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
