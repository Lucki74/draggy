import SwiftUI

public struct SkillsTabView: View {
    @Bindable var store: ExtensionStore
    @State private var catalog = SkillsCatalog()

    public init(store: ExtensionStore) {
        self.store = store
    }

    public var body: some View {
        VStack(spacing: 0) {
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Search skills...", text: $catalog.searchQuery)
                    .textFieldStyle(.plain)
            }
            .padding(8)
            .background(Color(nsColor: .controlBackgroundColor))

            Divider()

            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(catalog.filteredSkills) { skill in
                        SkillCardView(
                            skill: skill,
                            isEnabled: store.enabledSkills.contains(skill.id),
                            onToggle: {
                                store.toggleSkill(skill.id)
                            }
                        )
                    }
                }
                .padding(10)
            }
        }
    }
}
