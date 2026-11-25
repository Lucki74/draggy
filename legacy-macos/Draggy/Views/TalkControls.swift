import SwiftUI

public struct TalkControls: View {
    public let isMuted: Bool
    public let onToggleMute: () -> Void
    public let onEndSession: () -> Void

    public init(isMuted: Bool, onToggleMute: @escaping () -> Void, onEndSession: @escaping () -> Void) {
        self.isMuted = isMuted
        self.onToggleMute = onToggleMute
        self.onEndSession = onEndSession
    }

    public var body: some View {
        HStack(spacing: 20) {
            Button(action: onToggleMute) {
                Image(systemName: isMuted ? "mic.slash.fill" : "mic.fill")
                    .font(.title2)
                    .foregroundStyle(isMuted ? .red : .primary)
                    .padding(12)
                    .background(Color.secondary.opacity(0.15))
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)

            Button(action: onEndSession) {
                Image(systemName: "phone.down.fill")
                    .font(.title2)
                    .foregroundStyle(.white)
                    .padding(12)
                    .background(Color.red)
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
        }
    }
}
