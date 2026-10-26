import Foundation

public protocol CloudTTSProvider: Sendable {
    var id: String { get }
    var name: String { get }
    func synthesize(text: String, apiKey: String, voice: String) async throws -> Data
}
