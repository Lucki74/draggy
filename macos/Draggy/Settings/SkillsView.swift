import DraggyCore
import SwiftUI

struct SkillsView: View {
    @Bindable var skills: SkillsModel
    @State private var isPicking = false

    var body: some View {
        Form {
            Section {
                Text("Pick a folder that holds a SKILL.md. The model loads a skill when a request matches its description.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                Button("Add a skill folder") { isPicking = true }
                if let error = skills.lastError {
                    Text(error).font(.callout).foregroundStyle(.red)
                }
            }
            Section("Skills") {
                if skills.skills.isEmpty {
                    Text("No skills installed").foregroundStyle(.secondary)
                }
                ForEach(skills.skills, id: \.id) { skill in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(skill.name).font(.headline)
                            if !skill.description.isEmpty {
                                Text(skill.description).font(.callout).foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        Button {
                            skills.remove(skill.id)
                        } label: {
                            Label("Remove skill", systemImage: "trash").labelStyle(.iconOnly)
                        }
                        .buttonStyle(.borderless)
                    }
                }
            }
        }
        .formStyle(.grouped)
        .fileImporter(isPresented: $isPicking, allowedContentTypes: [.folder]) { result in
            if case let .success(url) = result { skills.add(url) }
        }
    }
}
