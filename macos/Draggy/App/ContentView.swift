import DraggyCore
import SwiftUI

struct ContentView: View {
    @Bindable var model: AppModel

    var body: some View {
        NavigationSplitView {
            List {
                Label("Chat", systemImage: "bubble.left")
            }
            .navigationSplitViewColumnWidth(min: 160, ideal: 200)
        } detail: {
            ChatView(model: model)
                .toolbar {
                    ToolbarItem {
                        Button("New chat", systemImage: "square.and.pencil") { model.newConversation() }
                            .disabled(model.isRunning)
                    }
                }
        }
        .frame(minWidth: 720, minHeight: 480)
        .sheet(isPresented: Binding(
            get: { model.pendingApproval != nil },
            set: { shown in if !shown { model.answerApproval(.no) } }
        )) {
            if let request = model.pendingApproval {
                ApprovalSheet(request: request) { model.answerApproval($0) }
            }
        }
    }
}

/// The core's question about a tool call: what it wants to do, and how long the answer should hold.
struct ApprovalSheet: View {
    let request: ApprovalRecord
    let answer: (ApprovalChoice) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Allow \(request.tool)?")
                .font(.headline)
            if let target = request.target {
                Text(target)
                    .font(.system(.body, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.quaternary, in: RoundedRectangle(cornerRadius: 6))
            }
            Text(request.reason)
                .foregroundStyle(.secondary)
            HStack {
                Button("Don't allow") { answer(.no) }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button("This task") { answer(.task) }
                Button("This workspace") { answer(.workspace) }
                Button("Once") { answer(.once) }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding()
        .frame(width: 520)
    }
}
