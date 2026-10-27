import Foundation

public final class VoiceEnhancer: Sendable {
    public static let shared = VoiceEnhancer()

    public init() {}

    public func enhance(samples: [Float], targetGain: Float = 1.2) -> [Float] {
        return samples.map { max(-1.0, min(1.0, $0 * targetGain)) }
    }
}
