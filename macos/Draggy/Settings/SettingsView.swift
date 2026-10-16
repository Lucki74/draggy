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
        }
        .padding()
        .frame(width: 440)
    }
}
