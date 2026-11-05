//! Runs `shared/fixtures/tools/sandbox-env.json` through the Rust port. The vitest runner in
//! `src/__tests__/fixtures/toolsSandbox.test.ts` calls electron/sandboxPolicy.cjs on the same file.

use draggy_testkit::cases;
use draggy_tools::sandbox::is_secret_name;
use serde_json::json;

#[test]
fn sandbox_env_fixtures_match_the_typescript_reference() {
    for case in cases("tools", "sandbox-env.json") {
        let name = case["input"]["name"].as_str().unwrap_or_default();
        assert_eq!(
            json!({ "secret": is_secret_name(name) }),
            case["expected"],
            "{}",
            case["name"]
        );
    }
}
