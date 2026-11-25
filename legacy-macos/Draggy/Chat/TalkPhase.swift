import Foundation

/// Where the hands-free conversation is: waiting for the user, waiting for the model, or reading the reply.
enum TalkPhase: Equatable {
    case off
    case listening
    case thinking
    case speaking

    var label: String {
        switch self {
        case .off: ""
        case .listening: String(localized: "Listening…")
        case .thinking: String(localized: "Thinking…")
        case .speaking: String(localized: "Speaking…")
        }
    }
}
