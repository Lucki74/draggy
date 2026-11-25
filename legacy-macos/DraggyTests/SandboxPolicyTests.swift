import XCTest
@testable import Draggy

final class SandboxPolicyTests: XCTestCase {
    /// The same spec as the first case in shared/fixtures/sandbox/policy.json.
    private let spec = SandboxSpec(
        project: "/work/app",
        cwd: "/work/app",
        readOnly: ["/opt/node"],
        readWrite: ["/work/app", "/scratch/chat-1"],
        network: false
    )

    func testSecretNamesAreFoundByPrefixSuffixAndSegment() {
        for name in ["ANTHROPIC_API_KEY", "GITHUB_TOKEN", "aws_region", "NPM_CONFIG_AUTH", "OPENAI_APIKEY", "DRAGGY_HOME"] {
            XCTAssertTrue(SandboxPolicy.isSecretName(name), name)
        }
        for name in ["PATH", "KEYBOARD", "MONKEY_PATCH", "TEMP", "HOMEPATH", "AUTHOR_NAME"] {
            XCTAssertFalse(SandboxPolicy.isSecretName(name), name)
        }
    }

    func testScrubEnvDropsSecretsAndKeepsTheRest() {
        let scrubbed = SandboxPolicy.scrubEnv(["PATH": "/usr/bin", "GITHUB_TOKEN": "x"])
        XCTAssertEqual(scrubbed, ["PATH": "/usr/bin"])
    }

    func testSeatbeltProfileMatchesTheGoldenPolicy() {
        let expected = [
            "(version 1)",
            "(deny default)",
            "(allow process-fork)",
            "(allow process-exec)",
            "(allow sysctl-read)",
            "(allow mach-lookup)",
            "(allow signal (target self))",
            "(allow file-read-metadata)",
            "(allow file-read* (subpath \"/usr\"))",
            "(allow file-read* (subpath \"/bin\"))",
            "(allow file-read* (subpath \"/sbin\"))",
            "(allow file-read* (subpath \"/System\"))",
            "(allow file-read* (subpath \"/Library\"))",
            "(allow file-read* (subpath \"/private/etc\"))",
            "(allow file-read* (subpath \"/dev\"))",
            "(allow file-read* (subpath \"/private/var/db\"))",
            "(allow file-read* (subpath \"/opt/node\"))",
            "(allow file-read* file-write* (subpath \"/work/app\"))",
            "(allow file-read* file-write* (subpath \"/scratch/chat-1\"))",
            "(allow file-write* (literal \"/dev/null\"))",
        ]
        let lines = SandboxPolicy.seatbeltProfile(spec).split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        XCTAssertEqual(Array(lines.dropLast()), expected)
        XCTAssertEqual(lines.last, "")
    }

    func testNetworkIsAllowedOnlyWhenTheSpecSaysSo() {
        XCTAssertFalse(SandboxPolicy.seatbeltProfile(spec).contains("network"))
        var online = spec
        online.network = true
        XCTAssertTrue(SandboxPolicy.seatbeltProfile(online).contains("(allow network*)"))
    }

    func testWrapRunsTheCommandAfterTheProfile() {
        let launch = SandboxPolicy.wrap(spec, command: ["/bin/zsh", "-l"])
        XCTAssertEqual(launch.executable, "/usr/bin/sandbox-exec")
        XCTAssertEqual(Array(launch.arguments.prefix(3)), ["-p", SandboxPolicy.seatbeltProfile(spec), "--"])
        XCTAssertEqual(Array(launch.arguments.suffix(2)), ["/bin/zsh", "-l"])
    }
}
