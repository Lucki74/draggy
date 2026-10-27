import SwiftUI

public struct ProjectGitView: View {
    @State private var monitor: GitStatusMonitor
    @State private var commitMessage: String = ""

    public init(rootPath: String = FileManager.default.currentDirectoryPath) {
        self._monitor = State(initialValue: GitStatusMonitor(rootPath: rootPath))
    }

    public var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("GIT CHANGES")
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundStyle(.secondary)
                Spacer()
                Button {
                    monitor.refresh()
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.plain)
            }
            .padding(10)
            .background(Color(nsColor: .controlBackgroundColor))

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if !monitor.status.staged.isEmpty {
                        Text("Staged Changes").font(.caption).foregroundStyle(.secondary)
                        ForEach(monitor.status.staged, id: \.self) { file in
                            HStack {
                                Text(file).font(.caption)
                                Spacer()
                                Image(systemName: "checkmark").foregroundStyle(.green)
                            }
                        }
                    }

                    if !monitor.status.modified.isEmpty {
                        Text("Modified Changes").font(.caption).foregroundStyle(.secondary)
                        ForEach(monitor.status.modified, id: \.self) { file in
                            HStack {
                                Text(file).font(.caption)
                                Spacer()
                                Button("Stage") {
                                    ProjectGitActions.shared.stage(files: [file], in: monitor.rootPath)
                                    monitor.refresh()
                                }
                                .controlSize(.mini)
                            }
                        }
                    }

                    if !monitor.status.untracked.isEmpty {
                        Text("Untracked Files").font(.caption).foregroundStyle(.secondary)
                        ForEach(monitor.status.untracked, id: \.self) { file in
                            HStack {
                                Text(file).font(.caption)
                                Spacer()
                                Button("Add") {
                                    ProjectGitActions.shared.stage(files: [file], in: monitor.rootPath)
                                    monitor.refresh()
                                }
                                .controlSize(.mini)
                            }
                        }
                    }
                }
                .padding(10)
            }

            Divider()

            VStack(spacing: 6) {
                TextField("Commit message...", text: $commitMessage)
                    .textFieldStyle(.roundedBorder)
                Button("Commit Staged") {
                    if !commitMessage.isEmpty {
                        ProjectGitActions.shared.commit(message: commitMessage, in: monitor.rootPath)
                        commitMessage = ""
                        monitor.refresh()
                    }
                }
                .buttonStyle(.borderedProminent)
                .frame(maxWidth: .infinity)
                .disabled(commitMessage.isEmpty || monitor.status.staged.isEmpty)
            }
            .padding(10)
        }
        .onAppear {
            monitor.refresh()
        }
    }
}
