import DraggyCore
import SwiftUI

struct McpView: View {
    @Bindable var mcp: McpModel

    var body: some View {
        Form {
            Section {
                TextField("Search", text: $mcp.query)
                Text("Servers listed here cannot be turned on yet.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            Section("Catalogue") {
                if mcp.servers.isEmpty {
                    Text("No server matches.").foregroundStyle(.secondary)
                }
                ForEach(mcp.servers, id: \.id) { server in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(server.name).font(.headline)
                            if server.remote {
                                Text("Remote").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if let docs = URL(string: server.docs) {
                                Link("Docs", destination: docs)
                            }
                        }
                        Text(server.description).foregroundStyle(.secondary)
                        if let caution = server.caution {
                            Text(caution).font(.callout).foregroundStyle(.orange)
                        }
                    }
                    .padding(.vertical, 2)
                    .accessibilityElement(children: .combine)
                }
            }
        }
        .padding()
    }
}
