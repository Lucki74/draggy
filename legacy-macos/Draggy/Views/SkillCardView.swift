import SwiftUI

public struct SkillCardView: View {
    public let skill: SkillDefinition
    public let isEnabled: Bool
    public let onToggle: () -> Void

    public init(skill: SkillDefinition, isEnabled: Bool, onToggle: @escaping () -> Void) {
        self.skill = skill
        self.isEnabled = isEnabled
        self.onToggle = onToggle
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(skill.name)
                    .font(.headline)
                Spacer()
                Toggle("", isOn: Binding(get: { isEnabled }, set: { _ in onToggle() }))
                    .toggleStyle(.switch)
                    .controlSize(.small)
            }

            Text(skill.description)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(3)

            if !skill.parameters.isEmpty {
                HStack(spacing: 4) {
                    ForEach(skill.parameters.prefix(3), id: \.name) { param in
                        Text(param.name)
                            .font(.system(size: 9, design: .monospaced))
                            .padding(.horizontal, 4)
                            .padding(.vertical, 2)
                            .background(Color.secondary.opacity(0.12))
                            .cornerRadius(3)
                    }
                }
            }
        }
        .padding(10)
        .background(Color(nsColor: .controlBackgroundColor))
        .cornerRadius(8)
    }
}
