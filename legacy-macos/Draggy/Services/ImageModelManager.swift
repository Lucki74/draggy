import Foundation

public struct ImageModelInfo: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let filename: String
    public let sizeBytes: Int64
    public var isDownloaded: Bool

    public init(id: String, name: String, filename: String, sizeBytes: Int64, isDownloaded: Bool = false) {
        self.id = id
        self.name = name
        self.filename = filename
        self.sizeBytes = sizeBytes
        self.isDownloaded = isDownloaded
    }
}

public final class ImageModelManager: Sendable {
    public static let shared = ImageModelManager()

    public init() {}

    public func availableModels() -> [ImageModelInfo] {
        return [
            ImageModelInfo(id: "sd-turbo", name: "SD Turbo (Fast)", filename: "sd_turbo.gguf", sizeBytes: 1_800_000_000, isDownloaded: true),
            ImageModelInfo(id: "sd-1.5", name: "Stable Diffusion 1.5", filename: "sd15.gguf", sizeBytes: 2_100_000_000, isDownloaded: false),
            ImageModelInfo(id: "flux-schnell", name: "FLUX.1 Schnell", filename: "flux-schnell.gguf", sizeBytes: 4_300_000_000, isDownloaded: false)
        ]
    }
}
