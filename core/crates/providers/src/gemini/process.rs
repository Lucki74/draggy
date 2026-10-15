//! What a Gemini CLI process starts with: its neutral home and workspace, its settings, its environment and the
//! handshake it opens with. The child itself is started by the shell, which owns the stdio the protocol reads.

use std::path::Path;

use serde_json::{Value, json};

use crate::account::env::{AccountEnv, EnvError, account_env};
use crate::account::supervisor::RuntimeUnavailable;
use crate::install_fs::FileView;

pub const SERVER: &str = "draggy";
pub const TOOL_PREFIX: &str = "mcp_draggy_";
// A pending tool call waits on the user's approval, so the runtime's per-call limit sits far above any wait.
pub const TOOL_TIMEOUT_MS: u64 = 24 * 60 * 60 * 1000;
pub const FLAGS: [&str; 2] = ["--acp", "--skip-trust"];
// Antivirus HTTPS scanning re-signs Google's sign-in traffic with a root only the system store holds.
pub const NODE_FLAGS: [&str; 1] = ["--use-system-ca"];

/// The neutral home and workspace paths. The CLI tells the model its temporary folder, which lies inside its home,
/// so both paths hold no user name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NeutralPaths {
    pub link: String,
    pub cwd: String,
}

pub fn neutral_paths(
    instance_id: &str,
    platform: &str,
    program_data: Option<&str>,
    uid: u32,
) -> NeutralPaths {
    let base = if platform == "win32" {
        let root = program_data
            .unwrap_or("C:\\ProgramData")
            .trim_end_matches(['\\', '/']);
        format!("{root}\\Draggy\\gemini-{instance_id}")
    } else {
        format!("/tmp/draggy-{uid}-gemini-{instance_id}")
    };
    NeutralPaths {
        cwd: format!("{base}-work"),
        link: base,
    }
}

/// The handshake the CLI opens with: protocol version one, and no file or terminal access for the client.
pub fn client_handshake() -> Value {
    json!({
        "protocolVersion": 1,
        "clientCapabilities": { "fs": { "readTextFile": false, "writeTextFile": false }, "terminal": false },
    })
}

/// The three files the CLI reads in place of its system settings, and the prompt file for this run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunFiles {
    pub settings: String,
    pub system: String,
    pub system_defaults: String,
    pub prompt: String,
}

/// The workspace settings a process gets: its tools, its model and the tool server. They outrank the user's settings.
pub fn settings_for(tools: &[String], model: Option<&str>, mcp_url: Option<&str>) -> Value {
    let mut settings = json!({
        "tools": { "core": tools.iter().map(|name| format!("{TOOL_PREFIX}{name}")).collect::<Vec<_>>() },
        "context": { "includeDirectoryTree": false },
        "general": { "enableAutoUpdate": false, "enableAutoUpdateNotification": false, "checkpointing": { "enabled": false } },
        "privacy": { "usageStatisticsEnabled": false },
        "telemetry": { "enabled": false },
        "skills": { "enabled": false },
        "hooksConfig": { "enabled": false },
        "security": { "auth": { "selectedType": "oauth-personal" } },
    });
    if let Some(object) = settings.as_object_mut() {
        if let Some(model) = model.filter(|model| !model.is_empty()) {
            object.insert("model".to_owned(), json!({ "name": model }));
        }
        if let Some(url) = mcp_url.filter(|url| !url.is_empty()) {
            object.insert(
                "mcpServers".to_owned(),
                json!({ SERVER: { "httpUrl": url, "timeout": TOOL_TIMEOUT_MS } }),
            );
        }
    }
    settings
}

/// The environment for one start: Draggy's prompt, system settings paths that never exist, and the home the CLI sees
/// is the neutral link. Built on the account allowlist, so nothing else from the shell gets through.
pub fn gemini_env(
    app_data: &str,
    instance_id: &str,
    parent: &[(String, String)],
    link: &str,
    files: Option<&RunFiles>,
    no_browser: bool,
) -> Result<AccountEnv, EnvError> {
    let mut extra: Vec<(String, String)> = vec![
        ("ELECTRON_RUN_AS_NODE".to_owned(), "1".to_owned()),
        ("GEMINI_FORCE_FILE_STORAGE".to_owned(), "true".to_owned()),
        // --skip-trust lands after the first settings read is cached, which leaves the workspace untrusted.
        ("GEMINI_CLI_TRUST_WORKSPACE".to_owned(), "true".to_owned()),
        (
            "GEMINI_CLI_CUSTOM_HEADERS".to_owned(),
            "User-Agent: Antigravity/1.15.0".to_owned(),
        ),
    ];
    if no_browser {
        extra.push(("NO_BROWSER".to_owned(), "true".to_owned()));
    }
    if let Some(files) = files {
        extra.push(("GEMINI_SYSTEM_MD".to_owned(), files.prompt.clone()));
        extra.push((
            "GEMINI_CLI_SYSTEM_SETTINGS_PATH".to_owned(),
            files.system.clone(),
        ));
        extra.push((
            "GEMINI_CLI_SYSTEM_DEFAULTS_PATH".to_owned(),
            files.system_defaults.clone(),
        ));
    }
    let mut built = account_env("gemini", app_data, instance_id, parent, &extra)?;
    for name in ["HOME", "USERPROFILE", "GEMINI_CLI_HOME"] {
        built.env.insert(name.to_owned(), link.to_owned());
    }
    Ok(built)
}

/// Whether two paths name the same folder. Windows compares without regard to case and a trailing separator.
pub fn same_path(a: &str, b: &str, platform: &str) -> bool {
    let clean = |p: &str| {
        let stripped = p.strip_prefix("\\\\?\\").unwrap_or(p);
        let trimmed = stripped.trim_end_matches(['\\', '/']).to_owned();
        if platform == "win32" {
            trimmed.to_ascii_lowercase()
        } else {
            trimmed
        }
    };
    clean(a) == clean(b)
}

/// What a path is on disk, as far as the neutral link needs: a link to a target, or anything else.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Node {
    Link(String),
    Other,
}

/// Creates the link and reads it back. The shell backs this with the disk; tests with a map.
pub trait Links: FileView {
    fn node(&self, path: &str) -> Option<Node>;
    fn make_junction(&mut self, target: &str, link: &str);
    fn make_dir(&mut self, path: &str);
}

/// The home the CLI sees is a link to the private one, which keeps the user profile's permissions on the credentials.
/// A link that is not ours, or a real folder, stops the start rather than being used.
pub fn link_home(
    link: &str,
    target: &str,
    platform: &str,
    links: &mut dyn Links,
) -> Result<String, RuntimeUnavailable> {
    match links.node(link) {
        None => {
            if let Some(parent) = Path::new(link).parent() {
                links.make_dir(&parent.to_string_lossy());
            }
            links.make_junction(target, link);
            Ok(link.to_owned())
        }
        Some(Node::Link(existing)) if same_path(&existing, target, platform) => Ok(link.to_owned()),
        Some(_) => Err(RuntimeUnavailable(format!(
            "{link} is not Draggy's link to the Google account's folder."
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::install_fs::memory::MemFs;

    impl Links for MemFs {
        fn node(&self, path: &str) -> Option<Node> {
            if let Some(target) = self.links.get(path) {
                return Some(Node::Link(target.clone()));
            }
            self.exists(path).then_some(Node::Other)
        }

        fn make_junction(&mut self, target: &str, link: &str) {
            self.links.insert(link.to_owned(), target.to_owned());
        }

        fn make_dir(&mut self, path: &str) {
            self.dirs.insert(path.to_owned());
        }
    }

    const APP: &str = "/data/Draggy";

    #[test]
    fn the_neutral_paths_hold_no_user_name() {
        let linux = neutral_paths("acct", "linux", None, 1000);
        assert_eq!(linux.link, "/tmp/draggy-1000-gemini-acct");
        assert_eq!(linux.cwd, "/tmp/draggy-1000-gemini-acct-work");
        let windows = neutral_paths("g1", "win32", Some("D:\\PD"), 0);
        assert_eq!(windows.link, "D:\\PD\\Draggy\\gemini-g1");
        assert_eq!(windows.cwd, "D:\\PD\\Draggy\\gemini-g1-work");
    }

    #[test]
    fn links_the_home_once_and_accepts_only_its_own_link_after() {
        let target = format!("{APP}/gemini/acct");
        let link = "/tmp/draggy-1000-gemini-acct";
        let mut fs = MemFs::default();
        assert_eq!(
            link_home(link, &target, "linux", &mut fs),
            Ok(link.to_owned())
        );
        assert_eq!(fs.links.get(link), Some(&target));
        assert_eq!(
            link_home(link, &target, "linux", &mut fs),
            Ok(link.to_owned())
        );
        let other = link_home(link, "/elsewhere", "linux", &mut fs);
        assert_eq!(
            other,
            Err(RuntimeUnavailable(format!(
                "{link} is not Draggy's link to the Google account's folder."
            )))
        );
    }

    #[test]
    fn refuses_a_real_folder_where_the_link_belongs() {
        let mut fs = MemFs::default();
        fs.make_dir("/tmp/draggy-1000-gemini-acct");
        let result = link_home(
            "/tmp/draggy-1000-gemini-acct",
            &format!("{APP}/gemini/acct"),
            "linux",
            &mut fs,
        );
        assert!(result.is_err());
    }

    #[test]
    fn windows_paths_compare_without_case_or_a_trailing_separator() {
        assert!(same_path("C:\\Users\\Me\\", "c:\\users\\me", "win32"));
        assert!(!same_path("/a/b", "/A/B", "linux"));
    }

    #[test]
    fn settings_name_the_tools_model_and_tool_server_only_when_given() {
        let settings = settings_for(
            &["read".to_owned()],
            Some("gemini-3-flash"),
            Some("http://127.0.0.1:4000/mcp/x"),
        );
        assert_eq!(settings["tools"]["core"], json!(["mcp_draggy_read"]));
        assert_eq!(settings["model"]["name"], json!("gemini-3-flash"));
        assert_eq!(
            settings["mcpServers"]["draggy"]["httpUrl"],
            json!("http://127.0.0.1:4000/mcp/x")
        );
        let bare = settings_for(&[], None, None);
        assert!(bare.get("model").is_none());
        assert!(bare.get("mcpServers").is_none());
    }

    #[test]
    fn the_environment_drops_keys_and_points_the_home_at_the_link() {
        let parent = vec![
            ("PATH".to_owned(), "/usr/bin".to_owned()),
            ("GOOGLE_API_KEY".to_owned(), "shell".to_owned()),
        ];
        let files = RunFiles {
            settings: "/w/.gemini/settings.json".to_owned(),
            system: "/w/.gemini/system.json".to_owned(),
            system_defaults: "/w/.gemini/system-defaults.json".to_owned(),
            prompt: "/data/run/p.md".to_owned(),
        };
        let built = gemini_env(APP, "acct", &parent, "/tmp/link", Some(&files), true)
            .expect("environment builds");
        assert!(!built.env.contains_key("GOOGLE_API_KEY"));
        assert_eq!(built.env.get("HOME").map(String::as_str), Some("/tmp/link"));
        assert_eq!(
            built.env.get("GEMINI_CLI_HOME").map(String::as_str),
            Some("/tmp/link")
        );
        assert_eq!(
            built.env.get("GEMINI_SYSTEM_MD").map(String::as_str),
            Some("/data/run/p.md")
        );
        assert_eq!(
            built.env.get("NO_BROWSER").map(String::as_str),
            Some("true")
        );
        assert_eq!(
            built.home,
            Path::new(APP)
                .join("gemini")
                .join("acct")
                .to_string_lossy()
                .into_owned()
        );
    }
}
