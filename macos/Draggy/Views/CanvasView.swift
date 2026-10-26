import SwiftUI

public struct CanvasView: View {
    @Bindable var store: CanvasStore

    public init(store: CanvasStore) {
        self.store = store
    }

    public var body: some View {
        ZStack {
            Color(nsColor: .windowBackgroundColor)
                .ignoresSafeArea()

            // Blocks on infinite canvas
            ForEach($store.blocks) { $block in
                VStack(alignment: .leading, spacing: 4) {
                    TextEditor(text: $block.text)
                        .font(.body)
                        .padding(6)
                        .background(Color.yellow.opacity(0.18))
                        .cornerRadius(6)
                }
                .frame(width: block.width, height: block.height)
                .position(x: block.x + block.width / 2, y: block.y + block.height / 2)
                .gesture(
                    DragGesture()
                        .onChanged { value in
                            block.x = value.location.x - block.width / 2
                            block.y = value.location.y - block.height / 2
                        }
                )
            }

            // Toolbar overlay
            VStack {
                HStack {
                    Spacer()
                    Button {
                        store.addBlock()
                    } label: {
                        Label("Add Note", systemImage: "plus")
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                }
                .padding(10)
                Spacer()
            }
        }
    }
}
