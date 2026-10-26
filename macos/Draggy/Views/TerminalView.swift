import SwiftUI

public struct TerminalView: View {
    @Bindable var session: ShellSession
    @State private var inputText: String = ""
    @FocusState private var isInputFocused: Bool

    public init(session: ShellSession) {
        self.session = session
    }

    public var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    Text(session.output.isEmpty ? "Starting \(session.shell.name)..." : session.output)
                        .font(.system(.body, design: .monospaced))
                        .foregroundStyle(Color.green)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(8)
                        .id("terminalBottom")
                }
                .background(Color.black.opacity(0.92))
                .onChange(of: session.output) { _, _ in
                    proxy.scrollTo("terminalBottom", anchor: .bottom)
                }
            }

            Divider()

            HStack(spacing: 8) {
                Text(">")
                    .font(.system(.body, design: .monospaced))
                    .foregroundStyle(.secondary)
                TextField("", text: $inputText)
                    .font(.system(.body, design: .monospaced))
                    .textFieldStyle(.plain)
                    .focused($isInputFocused)
                    .onSubmit {
                        let toSend = inputText + "\n"
                        session.writeInput(toSend)
                        inputText = ""
                    }
                Button("Send") {
                    let toSend = inputText + "\n"
                    session.writeInput(toSend)
                    inputText = ""
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(Color(nsColor: .windowBackgroundColor))
        }
        .onAppear {
            if !session.isRunning {
                session.start()
            }
            isInputFocused = true
        }
    }
}
