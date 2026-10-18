import XCTest
@testable import Draggy

final class ConversationLibraryTests: XCTestCase {
    private func makeLibrary() -> ConversationLibrary {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: folder) }
        return ConversationLibrary(folder: folder.appendingPathComponent("Conversations"))
    }

    private func pair(_ question: String) -> [SavedMessage] {
        [SavedMessage(role: "user", text: question), SavedMessage(role: "assistant", text: "ok")]
    }

    func testEachConversationComesBackByItsId() {
        let library = makeLibrary()
        let a = UUID(), b = UUID()
        library.save(pair("first"), as: a)
        library.save(pair("second"), as: b)
        XCTAssertEqual(library.load(a), pair("first"))
        XCTAssertEqual(library.load(b), pair("second"))
    }

    func testTheListIsTitledByTheFirstQuestionAndNewestFirst() throws {
        let library = makeLibrary()
        let old = UUID(), new = UUID()
        library.save(pair("old one\nmore"), as: old)
        library.save(pair("new one"), as: new)
        try FileManager.default.setAttributes(
            [.modificationDate: Date(timeIntervalSince1970: 0)],
            ofItemAtPath: library.folder.appendingPathComponent("\(old.uuidString).json").path)
        XCTAssertEqual(library.list().map(\.id), [new, old])
        XCTAssertEqual(library.list().map(\.title), ["new one", "old one"])
    }

    func testDeletingRemovesItFromTheList() {
        let library = makeLibrary()
        let id = UUID()
        library.save(pair("gone"), as: id)
        library.delete(id)
        XCTAssertEqual(library.list(), [])
    }

    func testStrayFilesAreNotListed() throws {
        let library = makeLibrary()
        try FileManager.default.createDirectory(at: library.folder, withIntermediateDirectories: true)
        try Data("x".utf8).write(to: library.folder.appendingPathComponent("notes.json"))
        XCTAssertEqual(library.list(), [])
    }

    func testLongTitlesAreCut() {
        XCTAssertEqual(ConversationLibrary.title(of: String(repeating: "a", count: 100)).count, 61)
    }

    func testTheOldSingleFileBecomesAConversation() throws {
        let library = makeLibrary()
        let legacy = library.folder.deletingLastPathComponent().appendingPathComponent("conversation.json")
        ConversationStore(url: legacy).save(pair("from before"))
        library.adopt(legacy: legacy)
        XCTAssertFalse(FileManager.default.fileExists(atPath: legacy.path))
        XCTAssertEqual(library.list().map(\.title), ["from before"])
    }
}
