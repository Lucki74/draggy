import Foundation
import SwiftUI

public struct CanvasBlock: Identifiable, Sendable {
    public let id: String
    public var x: CGFloat
    public var y: CGFloat
    public var width: CGFloat
    public var height: CGFloat
    public var text: String

    public init(id: String = UUID().uuidString, x: CGFloat = 50, y: CGFloat = 50, width: CGFloat = 200, height: CGFloat = 120, text: String = "") {
        self.id = id
        self.x = x
        self.y = y
        self.width = width
        self.height = height
        self.text = text
    }
}

@MainActor
@Observable
public final class CanvasStore {
    public var blocks: [CanvasBlock] = []
    public var selectedBlockId: String?

    public init() {}

    public func addBlock(x: CGFloat = 80, y: CGFloat = 80, text: String = "Note") {
        let block = CanvasBlock(x: x, y: y, text: text)
        blocks.append(block)
        selectedBlockId = block.id
    }

    public func removeSelected() {
        if let id = selectedBlockId {
            blocks.removeAll { $0.id == id }
            selectedBlockId = nil
        }
    }
}
