import DraggyCore
import XCTest
@testable import Draggy

/// The first-run setup: the model ladder against the Windows rule, and which steps show and may be left.
@MainActor
final class SetupTests: XCTestCase {
    func testTheLadderPicksWhatFitsInUnifiedMemory() {
        // 75% of 8 GB is 6 GB: Gemma 4 E4B needs exactly 6, the 9B needs 7.5.
        XCTAssertEqual(ModelLadder.recommended(memoryGB: 8, chip: "Apple M2").label, "Gemma 4 E4B")
        // 75% of 16 GB is 12: GPT-OSS 20B (14) is out, Ministral 3 14B (11) is the last that fits.
        XCTAssertEqual(ModelLadder.recommended(memoryGB: 16, chip: "Apple M3").label, "Ministral 3 14B")
        XCTAssertEqual(ModelLadder.recommended(memoryGB: 1, chip: "").label, "Qwen 3.5 0.8B")
    }

    func testAMaxChipTakesTheNextRungWhenAllItsMemoryHoldsIt() {
        XCTAssertEqual(ModelLadder.chipClass("Apple M4 Max"), .max)
        XCTAssertEqual(ModelLadder.chipClass("Intel(R) Core(TM) i9"), .base)
        XCTAssertEqual(ModelLadder.recommended(memoryGB: 16, chip: "Apple M3 Max").label, "GPT-OSS 20B")
        XCTAssertEqual(ModelLadder.recommended(memoryGB: 16, chip: "Apple M3 Pro").label, "Ministral 3 14B")
    }

    func testPendingRungsAreNeverPicked() {
        let pick = ModelLadder.recommended(memoryGB: 1024, chip: "Apple M3 Ultra")
        XCTAssertFalse(pick.pending)
        XCTAssertEqual(pick.label, "GLM-5.3-Flash Q5")
    }

    func testNeighboursAreOneLighterAndOneStrongerThatStillFitsMemory() {
        let options = ModelLadder.options(memoryGB: 16, chip: "Apple M3")
        XCTAssertEqual(options.pick.label, "Ministral 3 14B")
        XCTAssertEqual(options.lighter?.label, "Gemma 4 12B")
        XCTAssertEqual(options.stronger?.label, "GPT-OSS 20B")
        XCTAssertNil(ModelLadder.options(memoryGB: 1, chip: "").lighter)
    }

    func testEachPathShowsTheWindowsSteps() {
        XCTAssertEqual(SetupModel.steps(for: .local), [.welcome, .appearance, .source, .local, .preferences, .ready])
        XCTAssertEqual(SetupModel.steps(for: .provider), [.welcome, .appearance, .source, .provider, .preferences, .ready])
        XCTAssertEqual(SetupModel.steps(for: .both).count, 7)
    }

    func testTheProviderStepWaitsForAnAddressAndAModel() {
        let defaults = UserDefaults(suiteName: "setup.\(UUID().uuidString)")!
        let app = AppModel(defaults: defaults, library: ConversationLibrary(
            folder: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)))
        let setup = SetupModel(defaults: defaults)
        setup.path = .provider
        setup.step = .provider
        XCTAssertFalse(setup.canContinue(app))
        setup.providerURL = "http://localhost:11434/v1"
        XCTAssertFalse(setup.canContinue(app))
        setup.providerModel = "llama3"
        XCTAssertTrue(setup.canContinue(app))
        setup.next(app)
        XCTAssertEqual(setup.step, .preferences)
        XCTAssertFalse(setup.downloadsStarted, "a provider path never downloads a model")
    }

    func testTheBundledCatalogKeepsOnlyProvidersMacOSCanReach() {
        let usable = ProviderCatalog.usable()
        XCTAssertFalse(usable.isEmpty, "bundled_catalog.json is missing from the app bundle")
        let ids = Set(usable.map(\.id))
        XCTAssertTrue(ids.isSuperset(of: ["openai", "openrouter", "ollama", "lmstudio"]))
        XCTAssertTrue(ids.isDisjoint(with: ["anthropic", "gemini", "chatgpt", "claude"]))
        let ollama = usable.first { $0.id == "ollama" }
        XCTAssertEqual(ollama?.chatURL, "http://127.0.0.1:11434/v1")
        XCTAssertEqual(usable.first { $0.id == "custom" }?.needsKey, false)
        XCTAssertEqual(usable.first { $0.id == "openai" }?.needsKey, true)
    }

    func testALocalServersModelListIsRead() {
        let data = Data(#"{"object":"list","data":[{"id":"qwen3:8b"},{"id":"llama3"}]}"#.utf8)
        XCTAssertEqual(SetupProbe.modelIDs(in: data), ["qwen3:8b", "llama3"])
        XCTAssertEqual(SetupProbe.modelIDs(in: Data("not json".utf8)), [])
    }

    func testTheModelStepWaitsForHuggingFaceAndAKeyProviderForItsKey() {
        let defaults = UserDefaults(suiteName: "setup.\(UUID().uuidString)")!
        let app = AppModel(defaults: defaults, library: ConversationLibrary(
            folder: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)))
        let setup = SetupModel(defaults: defaults)
        setup.step = .local
        setup.choice = ModelLadder.rungs[0]
        XCTAssertFalse(setup.canContinue(app), "no download before Hugging Face has answered")

        setup.step = .provider
        let openai = ProviderCatalog.usable().first { $0.id == "openai" }!
        setup.pickProvider(openai)
        XCTAssertEqual(setup.providerURL, "https://api.openai.com/v1")
        XCTAssertFalse(setup.providerModel.isEmpty, "the catalog's first model is picked")
        XCTAssertFalse(setup.canContinue(app))
        setup.providerKey = "sk-test"
        XCTAssertTrue(setup.canContinue(app))
    }

    func testQuantisationsAreReadFromFileNames() {
        XCTAssertEqual(ModelsView.quant("Qwen3.5-4B-Q4_K_M.gguf"), "Q4_K_M")
        XCTAssertEqual(ModelsView.quant("gemma-4-12b-it-UD-Q4_K_XL.gguf"), "UD-Q4_K_XL")
        XCTAssertEqual(ModelsView.quant("gpt-oss-20b-mxfp4.gguf"), "MXFP4")
        XCTAssertNil(ModelsView.quant("model.safetensors"))
    }

    func testTextSizesMatchTheWindowsSetting() {
        XCTAssertEqual(TextSize.allCases.map(\.points), [13, 15, 18])
    }

    func testMLXBuildsAreLabelledInsteadOfOfferedAsDownloads() {
        let mlx = LibraryModelRecord(name: "Qwen3.8-27B-GSQ-RCO-MLX", reference: "uqer1244/Qwen3.8-27B-GSQ-RCO-MLX",
                                     description: "", capabilities: [], sizes: ["Q8_0"])
        let gguf = LibraryModelRecord(name: "Qwen3.8-27B", reference: "unsloth/Qwen3.8-27B-GGUF",
                                      description: "", capabilities: [], sizes: ["Q8_0"])
        XCTAssertTrue(ModelSearchView.isMLX(mlx))
        XCTAssertFalse(ModelSearchView.isMLX(gguf))
    }
}
