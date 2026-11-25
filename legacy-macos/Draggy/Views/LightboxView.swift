import SwiftUI

public struct LightboxView: View {
    public let image: NSImage?
    public let onDismiss: () -> Void

    public init(image: NSImage?, onDismiss: @escaping () -> Void) {
        self.image = image
        self.onDismiss = onDismiss
    }

    public var body: some View {
        ZStack {
            Color.black.opacity(0.85)
                .ignoresSafeArea()
                .onTapGesture(perform: onDismiss)

            if let img = image {
                Image(nsImage: img)
                    .resizable()
                    .scaledToFit()
                    .padding(40)
            }

            VStack {
                HStack {
                    Spacer()
                    Button(action: onDismiss) {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title)
                            .foregroundStyle(.white)
                    }
                    .buttonStyle(.plain)
                    .padding(20)
                }
                Spacer()
            }
        }
    }
}
