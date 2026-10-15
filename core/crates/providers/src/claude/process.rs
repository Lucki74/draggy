//! What a Claude Code process starts with: its arguments, its quiet environment and the folder it works in. The child
//! itself is started by the shell, since `spawn_hidden` pins stdin to null and a stream-json runtime reads it.

use serde_json::{Value, json};

pub const SERVER: &str = "draggy";
pub const TOOL_PREFIX: &str = "mcp__draggy__";
// A pending tool call waits on the user's approval, so the runtime's per-call limit sits far above any wait.
pub const TOOL_TIMEOUT_MS: u64 = 24 * 60 * 60 * 1000;

/// The MCP config flag's value, written exactly as the reference serialises it.
pub const MCP_CONFIG: &str = r#"{"mcpServers":{"draggy":{"type":"sdk","name":"draggy"}}}"#;

/// Every built-in stripped, stream-json both ways, and Draggy's own tools registered as an in-process server.
pub const FLAGS: [&str; 17] = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--tools",
    "",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--permission-prompt-tool",
    "stdio",
    "--mcp-config",
    MCP_CONFIG,
];

/// The variables that keep a runtime from telemetry, updates and error reports.
pub const QUIET: [(&str, &str); 4] = [
    ("DISABLE_TELEMETRY", "1"),
    ("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1"),
    ("DISABLE_ERROR_REPORTING", "1"),
    ("DISABLE_AUTOUPDATER", "1"),
];

/// The folder a runtime works in. The runtime tells the model this path, so it holds no user name.
pub fn work_folder(
    instance_id: &str,
    platform: &str,
    program_data: Option<&str>,
    uid: u32,
) -> String {
    if platform == "win32" {
        let base = program_data
            .unwrap_or("C:\\ProgramData")
            .trim_end_matches(['\\', '/']);
        return format!("{base}\\Draggy\\claude-{instance_id}");
    }
    format!("/tmp/draggy-{uid}-claude-{instance_id}")
}

/// One start's session choice and settings. A new session gets its id, a stored one is resumed, and a fork copies
/// `fork_from` up to the reply `at` into the new session.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SessionArgs<'a> {
    pub model: Option<&'a str>,
    pub effort: Option<&'a str>,
    /// Thinking is on unless asked off.
    pub thinking: Option<bool>,
    pub system_prompt: Option<&'a str>,
    pub session_id: &'a str,
    pub resume: bool,
    pub fork_from: Option<&'a str>,
    pub at: Option<&'a str>,
}

/// The session and settings flags for one start.
pub fn session_args(args: &SessionArgs<'_>) -> Vec<String> {
    let mut out: Vec<String> = vec![
        "--system-prompt".to_owned(),
        args.system_prompt.unwrap_or("").to_owned(),
    ];
    if let Some(model) = args.model.filter(|model| !model.is_empty()) {
        out.extend(["--model".to_owned(), model.to_owned()]);
    }
    if let Some(effort) = args.effort.filter(|effort| !effort.is_empty()) {
        out.extend(["--effort".to_owned(), effort.to_owned()]);
    }
    let thinking = if args.thinking.unwrap_or(true) {
        "adaptive"
    } else {
        "disabled"
    };
    out.extend(["--thinking".to_owned(), thinking.to_owned()]);
    match (args.fork_from, args.resume) {
        (Some(from), _) => out.extend([
            "--resume".to_owned(),
            from.to_owned(),
            format!("--resume-session-at={}", args.at.unwrap_or("")),
            "--fork-session".to_owned(),
            "--session-id".to_owned(),
            args.session_id.to_owned(),
        ]),
        (None, true) => out.extend(["--resume".to_owned(), args.session_id.to_owned()]),
        (None, false) => out.extend(["--session-id".to_owned(), args.session_id.to_owned()]),
    }
    out
}

/// The full argument list for a start: the fixed flags, then the session's.
pub fn start_args(args: &SessionArgs<'_>) -> Vec<String> {
    let mut out: Vec<String> = FLAGS.iter().map(|flag| (*flag).to_owned()).collect();
    out.extend(session_args(args));
    out
}

/// The initialize request's parameters: Draggy's tool server, with the limit a tool call may take.
pub fn initialize_params() -> Value {
    json!({
        "sdkMcpServers": [SERVER],
        "sdkMcpServerConfigs": { SERVER: { "timeout": TOOL_TIMEOUT_MS } },
        "title": "Draggy",
    })
}
