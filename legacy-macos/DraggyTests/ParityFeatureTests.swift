import XCTest
@testable import Draggy

final class ParityFeatureTests: XCTestCase {
    func testShellDetectionDefault() {
        let shell = ShellDetection.shared.defaultShell()
        XCTAssertFalse(shell.name.isEmpty)
        XCTAssertFalse(shell.path.isEmpty)
    }

    func testDiffParser() {
        let raw = """
        diff --git a/test.txt b/test.txt
        --- a/test.txt
        +++ b/test.txt
        @@ -1,1 +1,1 @@
        -hello
        +world
        """
        let diffs = DiffParser.shared.parse(diffText: raw)
        XCTAssertEqual(diffs.count, 1)
        XCTAssertEqual(diffs[0].lines.count, 3)
    }

    func testVAD() {
        let silence: [Float] = [0.0, 0.001, 0.002]
        XCTAssertFalse(VAD.shared.isSpeech(buffer: silence))

        let speech: [Float] = [0.2, 0.5, 0.3]
        XCTAssertTrue(VAD.shared.isSpeech(buffer: speech))
    }

    func testAudioDenoiser() {
        let input: [Float] = [1.0, 1.0, 1.0]
        let output = AudioDenoiser.shared.denoise(samples: input)
        XCTAssertEqual(output.count, 3)
    }

    func testAdBlocker() {
        let adUrl = URL(string: "https://ad.doubleclick.net/pixel")!
        XCTAssertTrue(AdBlocker.shared.shouldBlock(url: adUrl))

        let safeUrl = URL(string: "https://wikipedia.org/wiki/Main_Page")!
        XCTAssertFalse(AdBlocker.shared.shouldBlock(url: safeUrl))
    }

    func testMCPAuthCallback() {
        let cbUrl = URL(string: "https://example.com/oauth/callback?code=secret123")!
        let code = MCPAuthCallback.shared.extractCode(from: cbUrl)
        XCTAssertEqual(code, "secret123")
    }

    func testTierPlanner() {
        let hw = HardwareInfo(chip: "Apple M3", ramGB: 16, cores: 8, osVersion: "14.4", isAppleSilicon: true)
        let plan = TierPlanner.shared.plan(for: hw)
        XCTAssertEqual(plan.tierName, "Medium")
    }
}
