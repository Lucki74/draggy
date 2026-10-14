//! Installing and finding the npm packages that stdio servers run. An install goes through the tools crate's hidden spawn
//! and is given up after three minutes, as the reference gives it.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::Value;
use tokio::time::timeout;

use crate::js::trim;
use crate::ports::{BoxFuture, Provisioner};

/// How long an install may take before it is treated as stuck.
pub const INSTALL_TIMEOUT: Duration = Duration::from_millis(180_000);

/// How many trailing stderr lines an install failure shows.
const DETAIL_LINES: usize = 3;

/// The program and arguments an install runs. Logged with the arguments cut short, so a failure can be reproduced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallCommand {
    pub file: String,
    pub args: Vec<String>,
}

/// The npm program: the executable and the arguments that come before the npm subcommand.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NpmProgram {
    pub file: String,
    pub prefix_args: Vec<String>,
}

/// The folder a package is installed into, `node_modules/<name>`, with a scoped name split at its slash.
pub fn package_dir(root: &Path, package: &str) -> PathBuf {
    package
        .split('/')
        .fold(root.join("node_modules"), |dir, segment| dir.join(segment))
}

/// The file a package's manifest says to run: its bin (a text, or the first entry of an object), else its main.
/// Nothing when the manifest names none, or names something that is not text.
pub fn entry_name(manifest: &Value) -> Option<String> {
    let relative = match manifest.get("bin") {
        Some(Value::String(name)) => Value::String(name.clone()),
        Some(Value::Object(entries)) => entries.values().next().cloned().unwrap_or(Value::Null),
        Some(Value::Array(items)) => items.first().cloned().unwrap_or(Value::Null),
        _ => manifest.get("main").cloned().unwrap_or(Value::Null),
    };

    match relative {
        Value::String(name) if !name.is_empty() => Some(name),
        _ => None,
    }
}

/// The arguments of `npm install <package>` into the server root. Scripts are refused: a server has no business running one on install.
pub fn install_args(prefix: &[String], package: &str, root: &Path) -> Vec<String> {
    let mut args: Vec<String> = prefix.to_vec();
    args.extend(["install", package, "--prefix"].map(str::to_owned));
    args.push(root.to_string_lossy().into_owned());
    args.extend(
        [
            "--no-audit",
            "--no-fund",
            "--no-package-lock",
            "--ignore-scripts",
            "--loglevel",
            "error",
        ]
        .map(str::to_owned),
    );
    args
}

/// The last lines of an install's stderr, joined by spaces. Empty when there was none.
pub fn install_detail(stderr: &str) -> String {
    let trimmed = trim(stderr);
    let lines: Vec<&str> = trimmed.split('\n').collect();
    let start = lines.len().saturating_sub(DETAIL_LINES);
    lines[start..].join(" ")
}

/// The npm-backed provisioner: installs under one root, and finds packages there by their manifests.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NpmProvisioner {
    root: Option<PathBuf>,
    npm: Option<NpmProgram>,
}

impl NpmProvisioner {
    /// `root` is None until the app has said where its extensions live. `npm` is None when no npm was found.
    pub fn new(root: Option<PathBuf>, npm: Option<NpmProgram>) -> Self {
        Self { root, npm }
    }
}

impl Provisioner for NpmProvisioner {
    fn ready(&self) -> bool {
        self.root.is_some()
    }

    fn install_command(&self, package: &str) -> Option<InstallCommand> {
        let npm = self.npm.as_ref()?;
        let root = self.root.as_deref()?;
        Some(InstallCommand {
            file: npm.file.clone(),
            args: install_args(&npm.prefix_args, package, root),
        })
    }

    fn entry_point(&self, package: &str) -> Option<String> {
        let dir = package_dir(self.root.as_deref()?, package);
        let text = fs::read_to_string(dir.join("package.json")).ok()?;
        let manifest: Value = serde_json::from_str(&text).ok()?;
        let entry = dir.join(entry_name(&manifest)?);
        entry.exists().then(|| entry.to_string_lossy().into_owned())
    }

    fn install(&self, command: &InstallCommand) -> BoxFuture<'_, Result<(), String>> {
        let command = command.clone();
        Box::pin(async move {
            if let Some(root) = &self.root {
                fs::create_dir_all(root).map_err(|error| error.to_string())?;
            }

            let run = draggy_tools::spawn::exec_hidden(&command.file, &command.args, |cmd| {
                cmd.env("ELECTRON_RUN_AS_NODE", "1");
            });

            match timeout(INSTALL_TIMEOUT, run).await {
                Err(_) => Err("the download timed out".to_owned()),
                Ok(Err(error)) => Err(error.to_string()),
                Ok(Ok(output)) if output.status.success() => Ok(()),
                Ok(Ok(output)) => Err(install_detail(&String::from_utf8_lossy(&output.stderr))),
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn a_scoped_package_is_split_at_its_slash() {
        assert_eq!(
            package_dir(Path::new("/r"), "@scope/pkg"),
            Path::new("/r/node_modules/@scope/pkg")
        );
    }

    #[test]
    fn a_text_bin_is_the_entry() {
        assert_eq!(
            entry_name(&json!({"bin": "cli.js", "main": "lib.js"})).as_deref(),
            Some("cli.js")
        );
    }

    #[test]
    fn an_object_bin_takes_its_first_entry() {
        assert_eq!(
            entry_name(&json!({"bin": {"a": "first.js", "b": "second.js"}})).as_deref(),
            Some("first.js")
        );
    }

    #[test]
    fn a_blank_text_bin_is_no_entry_even_with_a_main() {
        assert_eq!(entry_name(&json!({"bin": "", "main": "lib.js"})), None);
    }

    #[test]
    fn main_is_the_entry_when_there_is_no_bin() {
        assert_eq!(
            entry_name(&json!({"main": "lib.js"})).as_deref(),
            Some("lib.js")
        );
    }

    #[test]
    fn a_manifest_naming_nothing_has_no_entry() {
        assert_eq!(entry_name(&json!({"name": "x"})), None);
        assert_eq!(entry_name(&json!({"bin": ""})), None);
        assert_eq!(entry_name(&json!({"bin": 5})), None);
        assert_eq!(entry_name(&json!({"bin": {}, "main": "lib.js"})), None);
    }

    #[test]
    fn install_arguments_refuse_scripts_and_keep_the_prefix() {
        let args = install_args(&["npm-cli.js".to_owned()], "pkg", Path::new("/r"));
        assert_eq!(
            args,
            [
                "npm-cli.js",
                "install",
                "pkg",
                "--prefix",
                "/r",
                "--no-audit",
                "--no-fund",
                "--no-package-lock",
                "--ignore-scripts",
                "--loglevel",
                "error",
            ]
        );
    }

    #[test]
    fn a_failed_install_shows_its_last_three_lines() {
        assert_eq!(install_detail("a\nb\nc\nd\n"), "b c d");
        assert_eq!(install_detail("  \n"), "");
    }
}
