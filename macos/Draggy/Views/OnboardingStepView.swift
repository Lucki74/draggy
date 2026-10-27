import SwiftUI

public struct OnboardingStepView: View {
    public let title: String
    public let description: String
    public let icon: String

    public init(title: String, description: String, icon: String) {
        self.title = title
        self.description = description
        self.icon = icon
    }

    public var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 48))
                .foregroundStyle(.blue)
            Text(title)
                .font(.title2)
                .fontWeight(.bold)
            Text(description)
                .font(.body)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
        }
        .padding(20)
    }
}
