//! The flags a llama-server build accepts, read from its own `--help` so a newer flag never reaches an older engine.
//! Kept in memory and on disk, since asking starts the GPU backends. Port of engineFlags in electron/llamaProcess.cjs.

use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::{Duration, UNIX_EPOCH};

use regex::Regex;
use serde_json::{Value, json};

use crate::command::{CommandRunner, ProcessSpec};

/// The file the flags are kept in beside the other engine files.
pub const FLAGS_FILE: &str = "engine-flags.json";
const HELP_TIMEOUT: Duration = Duration::from_secs(20);
/// A build that lists this few flags did not answer the question, so nothing is trusted from it.
const MIN_FLAGS: usize = 21;

static FLAG: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(r"--[a-z0-9][a-z0-9-]*").ok());

/// The flags each binary answered, by the key that identifies that build. A None answer is kept too.
#[derive(Debug, Default)]
pub struct FlagCache {
    entries: tokio::sync::Mutex<HashMap<String, Option<BTreeSet<String>>>>,
}

impl FlagCache {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Identifies a build by its path, size and modification time, so replacing the file asks again.
fn cache_key(binary: &Path) -> Option<String> {
    let meta = fs::metadata(binary).ok()?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0.0, |since| since.as_secs_f64() * 1000.0);
    Some(format!(
        "{}|{}|{}",
        binary.to_string_lossy(),
        meta.len(),
        mtime
    ))
}

/// The flags a build accepts, or None when it could not be asked or did not list enough to be believed.
pub async fn engine_flags<R: CommandRunner>(
    runner: &R,
    cache: &FlagCache,
    binary: &Path,
    env: &[(String, String)],
    cache_dir: Option<&Path>,
) -> Option<BTreeSet<String>> {
    let key = cache_key(binary)?;
    let mut entries = cache.entries.lock().await;
    if let Some(found) = entries.get(&key) {
        return found.clone();
    }
    let found = match read_saved(cache_dir, &key) {
        Some(flags) => Some(flags),
        None => ask(runner, binary, env, cache_dir, &key).await,
    };
    entries.insert(key, found.clone());
    found
}

/// Whether the build can stream experts from disk, which the tier planner needs to know.
pub async fn supports_moe_stream<R: CommandRunner>(
    runner: &R,
    cache: &FlagCache,
    binary: &Path,
    env: &[(String, String)],
    cache_dir: Option<&Path>,
) -> bool {
    engine_flags(runner, cache, binary, env, cache_dir)
        .await
        .is_some_and(|flags| flags.contains("--moe-stream-cache"))
}

/// The flags kept on disk for this exact build, or None when there is no usable copy.
fn read_saved(cache_dir: Option<&Path>, key: &str) -> Option<BTreeSet<String>> {
    let text = fs::read_to_string(cache_dir?.join(FLAGS_FILE)).ok()?;
    let saved: Value = serde_json::from_str(&text).ok()?;
    if saved.get("key")?.as_str()? != key {
        return None;
    }
    let flags = saved.get("flags")?.as_array()?;
    Some(
        flags
            .iter()
            .filter_map(|flag| flag.as_str().map(str::to_owned))
            .collect(),
    )
}

/// Asks the build for its `--help`, and keeps the answer when it lists enough flags.
async fn ask<R: CommandRunner>(
    runner: &R,
    binary: &Path,
    env: &[(String, String)],
    cache_dir: Option<&Path>,
    key: &str,
) -> Option<BTreeSet<String>> {
    let spec = ProcessSpec {
        program: binary.to_path_buf(),
        args: vec!["--help".to_owned()],
        cwd: binary
            .parent()
            .filter(|dir| !dir.as_os_str().is_empty())
            .map(PathBuf::from),
        env: Some(env.to_vec()),
        timeout: HELP_TIMEOUT,
    };
    let text = runner
        .run(spec)
        .await
        .map(|output| format!("{}\n{}", output.stdout, output.stderr))
        .unwrap_or_default();
    let flags: BTreeSet<String> = FLAG
        .as_ref()?
        .find_iter(&text)
        .map(|found| found.as_str().to_owned())
        .collect();
    if flags.len() < MIN_FLAGS {
        return None;
    }
    if let Some(dir) = cache_dir {
        let saved = json!({ "key": key, "flags": flags.iter().collect::<Vec<_>>() });
        if let Err(error) = fs::write(dir.join(FLAGS_FILE), saved.to_string()) {
            tracing::debug!(target: "engine.llama", error = %error, "engine flags not saved");
        }
    }
    Some(flags)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::CommandOutput;
    use std::sync::Mutex;

    /// Answers `--help` with a fixed text and counts the questions asked.
    struct HelpRunner {
        text: String,
        asked: Mutex<u32>,
    }

    impl CommandRunner for HelpRunner {
        async fn run(&self, spec: ProcessSpec) -> Option<CommandOutput> {
            assert_eq!(spec.args, vec!["--help".to_owned()]);
            *self.asked.lock().expect("count") += 1;
            Some(CommandOutput {
                success: true,
                stdout: self.text.clone(),
                stderr: String::new(),
            })
        }
    }

    fn many_flags(extra: &[&str]) -> String {
        let mut lines: Vec<String> = (0..25).map(|i| format!("  --flag-{i} value")).collect();
        lines.extend(extra.iter().map(|flag| format!("  {flag}")));
        lines.join("\n")
    }

    fn stand_in(dir: &Path) -> PathBuf {
        let binary = dir.join("llama-server");
        fs::write(&binary, "not run in these tests").expect("binary");
        binary
    }

    #[tokio::test]
    async fn the_build_is_asked_once_and_the_answer_is_kept_on_disk() {
        let dir = tempfile::tempdir().expect("temp dir");
        let binary = stand_in(dir.path());
        let runner = HelpRunner {
            text: many_flags(&["--moe-stream-cache"]),
            asked: Mutex::new(0),
        };
        let cache = FlagCache::new();
        let flags = engine_flags(&runner, &cache, &binary, &[], Some(dir.path()))
            .await
            .expect("flags");
        assert!(flags.contains("--moe-stream-cache"));
        assert!(dir.path().join(FLAGS_FILE).exists());

        // A fresh cache, as a later launch has, reads the saved answer instead of asking again.
        let again = engine_flags(&runner, &FlagCache::new(), &binary, &[], Some(dir.path()))
            .await
            .expect("saved flags");
        assert_eq!(again, flags);
        assert_eq!(*runner.asked.lock().expect("count"), 1);
    }

    #[tokio::test]
    async fn a_build_that_lists_too_few_flags_is_not_trusted() {
        let dir = tempfile::tempdir().expect("temp dir");
        let binary = stand_in(dir.path());
        let runner = HelpRunner {
            text: "--only-one".to_owned(),
            asked: Mutex::new(0),
        };
        let flags = engine_flags(&runner, &FlagCache::new(), &binary, &[], Some(dir.path())).await;
        assert!(flags.is_none());
        assert!(!dir.path().join(FLAGS_FILE).exists());
    }

    #[tokio::test]
    async fn a_missing_binary_has_no_flags_and_is_not_asked() {
        let dir = tempfile::tempdir().expect("temp dir");
        let runner = HelpRunner {
            text: many_flags(&[]),
            asked: Mutex::new(0),
        };
        let absent = dir.path().join("absent");
        assert!(
            engine_flags(&runner, &FlagCache::new(), &absent, &[], None)
                .await
                .is_none()
        );
        assert_eq!(*runner.asked.lock().expect("count"), 0);
    }

    #[tokio::test]
    async fn streaming_is_supported_only_when_the_build_lists_it() {
        let dir = tempfile::tempdir().expect("temp dir");
        let binary = stand_in(dir.path());
        let new = HelpRunner {
            text: many_flags(&["--moe-stream-cache"]),
            asked: Mutex::new(0),
        };
        assert!(supports_moe_stream(&new, &FlagCache::new(), &binary, &[], None).await);
        let old = HelpRunner {
            text: many_flags(&[]),
            asked: Mutex::new(0),
        };
        assert!(!supports_moe_stream(&old, &FlagCache::new(), &binary, &[], None).await);
    }
}
