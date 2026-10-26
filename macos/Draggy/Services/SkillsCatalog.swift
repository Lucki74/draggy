import Foundation

@MainActor
@Observable
public final class SkillsCatalog {
    public var skills: [SkillDefinition] = []
    public var searchQuery: String = ""

    public init() {
        self.skills = SkillsLibraryLoader.shared.loadBundledSkills()
    }

    public var filteredSkills: [SkillDefinition] {
        if searchQuery.trimmingCharacters(in: .whitespaces).isEmpty {
            return skills
        }
        return skills.filter {
            $0.name.localizedCaseInsensitiveContains(searchQuery) ||
            $0.description.localizedCaseInsensitiveContains(searchQuery)
        }
    }
}
