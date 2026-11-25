import XCTest
@testable import Draggy

@MainActor
final class SkillsModelTests: XCTestCase {
    func testASkillFolderIsInstalledListedAndRemoved() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let source = root.appendingPathComponent("notes")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try "---\nname: Notes\ndescription: Take notes\n---\nBe brief.\n"
            .write(to: source.appendingPathComponent("SKILL.md"), atomically: true, encoding: .utf8)
        let model = SkillsModel(directory: root.appendingPathComponent("shelf").path)
        XCTAssertTrue(model.skills.isEmpty)
        model.add(source)
        XCTAssertEqual(model.skills.map(\.name), ["Notes"])
        model.remove("notes")
        XCTAssertTrue(model.skills.isEmpty)
        try? FileManager.default.removeItem(at: root)
    }
}
