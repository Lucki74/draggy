import SwiftUI

public struct VoiceHeatView: View {
    public let level: Float
    public let isSpeaking: Bool

    public init(level: Float = 0.0, isSpeaking: Bool = false) {
        self.level = level
        self.isSpeaking = isSpeaking
    }

    public var body: some View {
        Circle()
            .fill(isSpeaking ? Color.green.opacity(0.8) : Color.blue.opacity(0.6))
            .frame(width: CGFloat(60 + level * 40), height: CGFloat(60 + level * 40))
            .animation(.easeInOut(duration: 0.15), value: level)
            .animation(.easeInOut(duration: 0.2), value: isSpeaking)
    }
}
