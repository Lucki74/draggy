import SwiftUI

public struct OnboardingFlowView: View {
    @State private var store = OnboardingStore()
    public let onComplete: () -> Void

    public init(onComplete: @escaping () -> Void) {
        self.onComplete = onComplete
    }

    public var body: some View {
        VStack(spacing: 20) {
            Spacer()

            if store.currentStep == 0 {
                OnboardingStepView(
                    title: "Welcome to Draggy",
                    description: "Your local-first desktop AI assistant. Fast, private, and running completely on your device.",
                    icon: "sparkles"
                )
            } else if store.currentStep == 1 {
                OnboardingStepView(
                    title: "Choose Your Language",
                    description: "Select your preferred application display language.",
                    icon: "globe"
                )
                Picker("Language", selection: $store.selectedLocale) {
                    Text("English").tag("en")
                    Text("Français").tag("fr")
                    Text("Español").tag("es")
                    Text("中文").tag("zh")
                }
                .pickerStyle(.segmented)
                .frame(width: 280)
            } else {
                OnboardingStepView(
                    title: "Initial Engine Setup",
                    description: "Preparing your native llama.cpp environment and starter model weights.",
                    icon: "cpu"
                )
                DownloadProgressBar(progress: store.downloadProgress)
                    .frame(width: 300)
            }

            Spacer()

            HStack {
                if store.currentStep > 0 {
                    Button("Back") {
                        store.currentStep -= 1
                    }
                }
                Spacer()
                Button(store.currentStep == 2 ? "Get Started" : "Continue") {
                    if store.currentStep == 2 {
                        store.finish()
                        onComplete()
                    } else {
                        store.nextStep()
                    }
                }
                .buttonStyle(.borderedProminent)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 16)
        }
        .frame(width: 480, height: 380)
    }
}
