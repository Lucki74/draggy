import SwiftUI

public struct ImageModelSelector: View {
    @Binding var selectedModelId: String
    let models: [ImageModelInfo]

    public init(selectedModelId: Binding<String>, models: [ImageModelInfo] = ImageModelManager.shared.availableModels()) {
        self._selectedModelId = selectedModelId
        self.models = models
    }

    public var body: some View {
        Picker("Model", selection: $selectedModelId) {
            ForEach(models) { m in
                Text(m.name).tag(m.id)
            }
        }
        .pickerStyle(.menu)
    }
}
