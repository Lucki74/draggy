import XCTest
@testable import Draggy

/// A message with no model to take it stays in the box with the reason, instead of a core error.
@MainActor
final class SendReadinessTests: XCTestCase {
    private func makeModel() -> AppModel {
        let defaults = UserDefaults(suiteName: "send.\(UUID().uuidString)")!
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: folder) }
        return AppModel(defaults: defaults, library: ConversationLibrary(folder: folder))
    }

    func testWithNoModelTheDraftStaysAndTheReasonShows() async {
        let model = makeModel()
        model.modelName = ""
        model.draft = "hello"
        await model.send()
        XCTAssertEqual(model.draft, "hello")
        XCTAssertEqual(model.errorMessage, String(localized: "No model is loaded, so messages have nowhere to go yet."))
        XCTAssertTrue(model.transcript.lines.isEmpty)
    }

    func testAProviderIsNotTheEngine() {
        let model = makeModel()
        XCTAssertTrue(model.usesEngine, "no model yet means the engine")
        model.baseURL = "https://api.openai.com/v1"
        model.modelName = "gpt-5-mini"
        XCTAssertFalse(model.usesEngine)
        XCTAssertNil(model.sendBlocker)
    }
}
