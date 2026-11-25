import SwiftUI

public struct TalkModeView: View {
    @State private var isMuted: Bool = false
    @State private var userCaption: String = ""
    @State private var assistantCaption: String = ""
    @State private var audioLevel: Float = 0.2

    public init() {}

    public var body: some View {
        VStack(spacing: 30) {
            Spacer()

            VoiceHeatView(level: audioLevel, isSpeaking: !isMuted)

            TalkCaptions(userText: userCaption, assistantText: assistantCaption)

            Spacer()

            TalkControls(
                isMuted: isMuted,
                onToggleMute: {
                    isMuted.toggle()
                    if !isMuted {
                        Earcons.shared.playListening()
                    }
                },
                onEndSession: {
                    Earcons.shared.playDone()
                }
            )
            .padding(.bottom, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
        .onAppear {
            Earcons.shared.playListening()
        }
    }
}
