import Foundation
import AppKit

public struct GeneratedImageItem: Identifiable, Sendable {
    public let id: UUID
    public let prompt: String
    public let image: NSImage?
    public let createdAt: Date
    public let modelId: String

    public init(id: UUID = UUID(), prompt: String, image: NSImage?, modelId: String) {
        self.id = id
        self.prompt = prompt
        self.image = image
        self.createdAt = Date()
        self.modelId = modelId
    }
}

@MainActor
@Observable
public final class ImageEngine {
    public var isGenerating: Bool = false
    public var progress: Double = 0.0
    public var history: [GeneratedImageItem] = []
    public var activeModelId: String = "sd-turbo"

    public init() {}

    public func generate(prompt: String, steps: Int = 20, width: Int = 512, height: Int = 512) async -> GeneratedImageItem? {
        guard !prompt.isEmpty else { return nil }
        isGenerating = true
        progress = 0.1

        // Simulate step progress or communicate with local sd-server
        for i in 1...steps {
            try? await Task.sleep(nanoseconds: 50_000_000)
            progress = Double(i) / Double(steps)
        }

        // Create bitmap placeholder or load from sd server
        let size = NSSize(width: width, height: height)
        let img = NSImage(size: size)
        img.lockFocus()
        NSColor.systemIndigo.withAlphaComponent(0.8).setFill()
        NSRect(origin: .zero, size: size).fill()
        img.unlockFocus()

        let item = GeneratedImageItem(prompt: prompt, image: img, modelId: activeModelId)
        history.insert(item, at: 0)
        isGenerating = false
        progress = 1.0
        return item
    }
}
