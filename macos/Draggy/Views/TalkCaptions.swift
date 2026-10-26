import SwiftUI

public struct TalkCaptions: View {
    public let userText: String
    public let assistantText: String

    public init(userText: String, assistantText: String) {
        self.userText = userText
        self.assistantText = assistantText
    }

    public var body: some View {
        VStack(spacing: 8) {
            if !userText.isEmpty {
                Text(userText)
                    .font(.headline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            if !assistantText.isEmpty {
                Text(assistantText)
                    .font(.title3)
                    .fontWeight(.medium)
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.horizontal, 24)
        .frame(minHeight: 80)
    }
}
