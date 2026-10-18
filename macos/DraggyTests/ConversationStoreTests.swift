import XCTest
@testable import Draggy

final class ConversationStoreTests: XCTestCase {
    private func makeStore() -> ConversationStore {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: folder) }
        return ConversationStore(url: folder.appendingPathComponent("nested/conversation.json"))
    }

    func testMessagesComeBackAsSaved() {
        let store = makeStore()
        let messages = [SavedMessage(role: "user", text: "hi"), SavedMessage(role: "assistant", text: "Hello")]
        store.save(messages)
        XCTAssertEqual(store.load(), messages)
    }

    func testToolStepsComeBackWithTheirReply() {
        let step = Transcript.Step(kind: "bash", label: "bash ls", isDone: true, detail: "a.txt")
        let store = makeStore()
        let saved = [
            SavedMessage(role: "user", text: "list"),
            SavedMessage(role: "assistant", text: "done", steps: [step]),
        ]
        store.save(saved)
        XCTAssertEqual(Transcript(restoring: store.load()).lines.last?.steps, [step])
    }

    func testFilesWithoutStepsStillLoad() throws {
        let store = makeStore()
        try FileManager.default.createDirectory(
            at: store.url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(#"[{"role":"user","text":"hi"},{"role":"assistant","text":"yo"}]"#.utf8).write(to: store.url)
        XCTAssertEqual(store.load().count, 2)
        XCTAssertNil(store.load()[1].steps)
    }

    func testAMissingFileIsAnEmptyConversation() {
        XCTAssertEqual(makeStore().load(), [])
    }

    func testAnUnreadableFileIsAnEmptyConversation() throws {
        let store = makeStore()
        try FileManager.default.createDirectory(
            at: store.url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("not json".utf8).write(to: store.url)
        XCTAssertEqual(store.load(), [])
    }

    func testSavingNothingRemovesTheFile() {
        let store = makeStore()
        store.save([SavedMessage(role: "user", text: "hi")])
        store.save([])
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.url.path))
    }

    func testRestoringBuildsTheSameLines() {
        let saved = [SavedMessage(role: "user", text: "hi"), SavedMessage(role: "assistant", text: "Hello")]
        let transcript = Transcript(restoring: saved)
        XCTAssertEqual(transcript.lines.map(\.role), [.user, .assistant])
        XCTAssertEqual(transcript.savedMessages, saved)
    }

    func testAQuestionWithoutAReplyIsNotSaved() {
        var transcript = Transcript()
        transcript.addUser("first")
        transcript.beginReply()
        transcript.setReply("answer")
        transcript.addUser("second")
        transcript.beginReply()
        XCTAssertEqual(
            transcript.savedMessages,
            [SavedMessage(role: "user", text: "first"), SavedMessage(role: "assistant", text: "answer")])
    }

    func testAFailedQuestionBeforeANewOneKeepsOnlyTheNewPair() {
        var transcript = Transcript()
        transcript.addUser("failed")
        transcript.beginReply()
        transcript.addUser("retry")
        transcript.beginReply()
        transcript.setReply("ok")
        XCTAssertEqual(
            transcript.savedMessages,
            [SavedMessage(role: "user", text: "retry"), SavedMessage(role: "assistant", text: "ok")])
    }
}
