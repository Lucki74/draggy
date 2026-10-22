import DraggyCore
import SwiftUI

struct McpView: View {
    @Bindable var mcp: McpModel

    var body: some View {
        Form {
            Section {
                TextField("Search", text: $mcp.query)
                if mcp.manager == nil {
                    Text("The server manager could not start, so servers cannot be turned on.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                if let error = mcp.lastError {
                    Text(error).font(.callout).foregroundStyle(.red)
                }
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
                            if mcp.manager != nil {
                                Button(mcp.running.contains(server.id) ? "Stop" : "Start") {
                                    Task { await mcp.toggle(server.id) }
                                }
                                .disabled(mcp.busy.contains(server.id))
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
        .task { await mcp.reload() }
    }
}
