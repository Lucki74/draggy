import DraggyCore
import Foundation
import Observation

/// The skills the model may load: one folder each under Application Support, with a `SKILL.md`.
@MainActor
@Observable
final class SkillsModel {
    private(set) var skills: [SkillRecord] = []
    private(set) var lastError: String?
    private let directory: String

    /// `~/Library/Application Support/Draggy/skills`.
    nonisolated static var standardDirectory: String {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Draggy/skills").path
    }

    init(directory: String = SkillsModel.standardDirectory) {
        self.directory = directory
        refresh()
    }

    func refresh() {
        skills = listSkills(dir: directory)
    }

    func add(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
            _ = try installSkill(dir: directory, source: url.path)
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
        refresh()
    }

    func remove(_ id: String) {
        do {
            try removeSkill(dir: directory, id: id)
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
        refresh()
    }
}
