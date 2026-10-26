import Foundation

public final class VAD: Sendable {
    public static let shared = VAD()

    private let energyThreshold: Float = 0.015

    public init() {}

    public func isSpeech(buffer: [Float]) -> Bool {
        guard !buffer.isEmpty else { return false }
        var sumSquares: Float = 0
        for sample in buffer {
            sumSquares += sample * sample
        }
        let rms = sqrt(sumSquares / Float(buffer.count))
        return rms > energyThreshold
    }
}
