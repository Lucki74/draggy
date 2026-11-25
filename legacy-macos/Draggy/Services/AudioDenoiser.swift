import Foundation

public final class AudioDenoiser: Sendable {
    public static let shared = AudioDenoiser()

    public init() {}

    public func denoise(samples: [Float]) -> [Float] {
        // High-pass filtering to remove low-frequency rumble and DC bias
        guard samples.count > 1 else { return samples }
        var output = [Float](repeating: 0, count: samples.count)
        let alpha: Float = 0.95
        output[0] = samples[0]
        for i in 1..<samples.count {
            output[i] = alpha * (output[i - 1] + samples[i] - samples[i - 1])
        }
        return output
    }
}
