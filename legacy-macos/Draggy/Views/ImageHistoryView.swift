import SwiftUI

public struct ImageHistoryView: View {
    public let history: [GeneratedImageItem]
    public let onSelect: (GeneratedImageItem) -> Void

    public init(history: [GeneratedImageItem], onSelect: @escaping (GeneratedImageItem) -> Void) {
        self.history = history
        self.onSelect = onSelect
    }

    public var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 8)], spacing: 8) {
                ForEach(history) { item in
                    VStack(alignment: .leading, spacing: 4) {
                        if let img = item.image {
                            Image(nsImage: img)
                                .resizable()
                                .scaledToFit()
                                .cornerRadius(6)
                        } else {
                            Rectangle()
                                .fill(Color.gray.opacity(0.2))
                                .aspectRatio(1, contentMode: .fit)
                                .cornerRadius(6)
                        }

                        Text(item.prompt)
                            .font(.caption2)
                            .lineLimit(1)
                            .foregroundStyle(.secondary)
                    }
                    .padding(4)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        onSelect(item)
                    }
                }
            }
            .padding(8)
        }
    }
}
