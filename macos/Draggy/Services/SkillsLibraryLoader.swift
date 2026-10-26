import Foundation

public final class SkillsLibraryLoader: Sendable {
    public static let shared = SkillsLibraryLoader()

    public init() {}

    public func loadSkills(from url: URL) -> [SkillDefinition] {
        guard let data = try? Data(contentsOf: url),
              let list = try? JSONDecoder().decode([SkillDefinition].self, from: data) else {
            return []
        }
        return list
    }

    public func loadBundledSkills() -> [SkillDefinition] {
        if let bundleUrl = Bundle.main.url(forResource: "skills-library", withExtension: "json") {
            return loadSkills(from: bundleUrl)
        }
        return []
    }
}
