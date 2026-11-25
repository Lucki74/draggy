import AppKit
import Foundation

public final class Earcons: Sendable {
    public static let shared = Earcons()

    public init() {}

    public func playListening() {
        NSSound(named: "Tink")?.play()
    }

    public func playThinking() {
        NSSound(named: "Pop")?.play()
    }

    public func playDone() {
        NSSound(named: "Purr")?.play()
    }
}
