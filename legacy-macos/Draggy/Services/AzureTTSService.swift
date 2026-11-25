import Foundation

public final class AzureTTSService: CloudTTSProvider {
    public let id = "azure"
    public let name = "Azure Neural TTS"

    public init() {}

    public func synthesize(text: String, apiKey: String, voice: String) async throws -> Data {
        return Data()
    }
}
