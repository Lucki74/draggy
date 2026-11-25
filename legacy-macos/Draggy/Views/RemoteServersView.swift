import SwiftUI

public struct RemoteServersView: View {
    @Bindable var store: ExtensionStore
    @State private var showingAddModal: Bool = false
    @State private var nameBuffer: String = ""
    @State private var urlBuffer: String = ""

    public init(store: ExtensionStore) {
        self.store = store
    }

    public var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("REMOTE SERVERS")
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundStyle(.secondary)
                Spacer()
                Button {
                    nameBuffer = ""
                    urlBuffer = "http://localhost:8000"
                    showingAddModal = true
                } label: {
                    Image(systemName: "plus")
                }
                .buttonStyle(.plain)
            }
            .padding(8)
            .background(Color(nsColor: .controlBackgroundColor))

            Divider()

            if store.remoteServers.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "server.rack")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                    Text("No remote servers configured")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(store.remoteServers) { server in
                    HStack {
                        Circle()
                            .fill(server.isConnected ? Color.green : Color.gray)
                            .frame(width: 8, height: 8)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(server.name).font(.subheadline)
                            Text(server.url).font(.caption2).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button(role: .destructive) {
                            store.removeServer(id: server.id)
                        } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .sheet(isPresented: $showingAddModal) {
            VStack(alignment: .leading, spacing: 12) {
                Text("Add Remote Server").font(.headline)
                TextField("Server Name", text: $nameBuffer)
                    .textFieldStyle(.roundedBorder)
                TextField("Server URL", text: $urlBuffer)
                    .textFieldStyle(.roundedBorder)
                HStack {
                    Spacer()
                    Button("Cancel") { showingAddModal = false }
                    Button("Add") {
                        if !nameBuffer.isEmpty && !urlBuffer.isEmpty {
                            store.addServer(name: nameBuffer, url: urlBuffer)
                            showingAddModal = false
                        }
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .padding(16)
            .frame(width: 320)
        }
    }
}
