import SwiftUI

public struct MCPAuthView: View {
    public let serverName: String
    public let authUrl: URL?
    public let onComplete: (Bool) -> Void

    public init(serverName: String, authUrl: URL?, onComplete: @escaping (Bool) -> Void) {
        self.serverName = serverName
        self.authUrl = authUrl
        self.onComplete = onComplete
    }

    public var body: some View {
        VStack(spacing: 16) {
            Text("Authenticate with \(serverName)")
                .font(.headline)

            Text("Sign in through your browser to grant Draggy access to this MCP server.")
                .font(.body)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)

            HStack(spacing: 12) {
                Button("Cancel") {
                    onComplete(false)
                }

                Button("Open Browser") {
                    if let url = authUrl {
                        FileOperations.shared.openFile(at: url.absoluteString)
                        onComplete(true)
                    }
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(20)
        .frame(width: 360)
    }
}
