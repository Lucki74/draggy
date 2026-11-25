import Foundation

public final class ElevenLabsService: CloudTTSProvider {
    public let id = "elevenlabs"
    public let name = "ElevenLabs"

    public init() {}

    public func synthesize(text: String, apiKey: String, voice: String) async throws -> Data {
        return Data()
    }
}
