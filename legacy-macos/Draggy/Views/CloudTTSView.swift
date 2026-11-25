import SwiftUI

public struct CloudTTSView: View {
    @State private var selectedProvider: String = "elevenlabs"
    @State private var hasConsent: Bool = false
    @State private var apiKey: String = ""

    public init() {}

    public var body: some View {
        Form {
            Section("Cloud Text to Speech") {
                Picker("Provider", selection: $selectedProvider) {
                    Text("ElevenLabs").tag("elevenlabs")
                    Text("Azure Neural").tag("azure")
                }

                SecureField("API Key", text: $apiKey)

                Toggle("Consent to send text to \(selectedProvider)", isOn: $hasConsent)
                    .onChange(of: hasConsent) { _, granted in
                        if granted {
                            TTSConsentManager.shared.grantConsent(for: selectedProvider)
                        } else {
                            TTSConsentManager.shared.revokeConsent(for: selectedProvider)
                        }
                    }
            }
        }
        .padding(14)
        .onAppear {
            hasConsent = TTSConsentManager.shared.hasConsent(for: selectedProvider)
        }
    }
}
