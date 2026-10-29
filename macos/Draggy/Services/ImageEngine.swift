import Foundation
import AppKit

public struct GeneratedImageItem: Identifiable, @unchecked Sendable {
    public let id: UUID
    public let prompt: String
    public let image: NSImage?
    public let createdAt: Date
    public let modelId: String
    /// The tracked picture this one started from, when a reference was given.
    public let reference: String?
    /// True when a reference was given but the engine could not use it, so the picture came from the prompt alone.
    public let referenceDropped: Bool

    public init(id: UUID = UUID(), prompt: String, image: NSImage?, modelId: String, reference: String? = nil, referenceDropped: Bool = false) {
        self.id = id
        self.prompt = prompt
        self.image = image
        self.createdAt = Date()
        self.modelId = modelId
        self.reference = reference
        self.referenceDropped = referenceDropped
    }
}

@MainActor
@Observable
public final class ImageEngine {
    public var isGenerating: Bool = false
    public var progress: Double = 0.0
    public var history: [GeneratedImageItem] = []
    public var activeModelId: String = "sd-turbo"

    /// The default strength of a reference: low, so a small detail changes and the rest stays.
    public static let defaultReferenceStrength: Double = 0.35

    public init() {}

    /// The placeholder engine cannot sample from a picture, so a reference is recorded and marked dropped. A real
    /// engine replaces it and uses `strength`.
    public func generate(prompt: String, reference: String? = nil, strength: Double? = nil, steps: Int = 20, width: Int = 512, height: Int = 512) async -> GeneratedImageItem? {
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

        let item = GeneratedImageItem(prompt: prompt, image: img, modelId: activeModelId, reference: reference, referenceDropped: reference != nil)
        history.insert(item, at: 0)
        isGenerating = false
        progress = 1.0
        return item
    }
}
