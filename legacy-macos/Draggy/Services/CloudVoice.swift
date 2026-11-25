import Foundation

public final class CloudVoice: Sendable {
    public static let shared = CloudVoice()

    public init() {}

    public func synthesize(text: String, apiKey: String, provider: String = "elevenlabs") async throws -> Data {
        // Prepare request to cloud TTS provider endpoint
        return Data()
    }
}
