//! Keeps the llama.cpp engine current: stage a faster or newer build, swap it in at launch, and roll back a build
//! whose first load crashes. Port of electron/engineUpdater.cjs; the background timers belong to the shell.

use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;
use serde_json::{Map, Value};

use crate::binary_manager::{
    BinaryError, Downloader, Extractor, GpuProfile, Release, Toolkit, build_number,
    detect_gpu_runner, download_engine, engine_environment, fetch_json, gpu_profile, iso_from_ms,
    make_executable, ms_from_iso, pick_release_assets, read_engine_meta, remove_tree,
    write_engine_meta,
};
use crate::command::{CommandRunner, ProcessSpec};
use crate::js;
use crate::platform::{Os, Platform};

const CHECK_EVERY_MS: i64 = 3 * 24 * 3600 * 1000;
/// llama.cpp publishes several builds a day; one that survives three days has not been pulled.
const SETTLE_MS: i64 = 3 * 24 * 3600 * 1000;
/// The most GitHub hands out per page, so a settled build is still in the list on a busy week.
const UPDATE_RELEASES_URL: &str =
    "https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=100";
const FAILED_TAG_LIMIT: usize = 20;
const PROBE_TIMEOUT: Duration = Duration::from_millis(30000);

static CUDA_RUNTIME: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"^(?:cudart64_|libcudart\.so\.)([0-9]+)").ok());
static BUILD_FROM_BANNER: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"\(build ([0-9]+)").ok());
static BUILD_OLD_BANNER: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"version:\s*([0-9]+)\s*\(").ok());

/// Where the staged build waits for the next launch.
fn pending_dir(llama_dir: &Path) -> PathBuf {
    PathBuf::from(format!("{}.pending", llama_dir.display()))
}

fn previous_dir(llama_dir: &Path) -> PathBuf {
    PathBuf::from(format!("{}.previous", llama_dir.display()))
}

fn failed_dir(llama_dir: &Path) -> PathBuf {
    PathBuf::from(format!("{}.failed", llama_dir.display()))
}

/// "cuda-12.4" becomes "cuda-12", "rocm-10.0" becomes "rocm", "vulkan" stays "vulkan".
pub fn variant_family(variant: &str) -> String {
    let mut parts = variant.split('-');
    let kind = parts.next().unwrap_or("");
    let version = parts.next().unwrap_or("");
    if kind == "cuda" && !version.is_empty() {
        let major = js::parse_int(version).map_or_else(|| "NaN".to_owned(), |n| format!("{n}"));
        return format!("cuda-{major}");
    }
    kind.to_owned()
}

/// Which CUDA major a folder's runtime libraries are for, or 0.
pub fn cuda_major_in(dir: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    for entry in entries.filter_map(Result::ok) {
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(major) = CUDA_RUNTIME
            .as_ref()
            .and_then(|re| re.captures(&name))
            .and_then(|captures| captures.get(1))
            .and_then(|m| m.as_str().parse::<u64>().ok())
        {
            return major;
        }
    }
    0
}

/// The family of what is installed, even for an engine installed before engine.json existed.
pub fn installed_family(
    platform: &Platform,
    llama_dir: &Path,
    meta: &Map<String, Value>,
    vram_gb: f64,
    nvidia: bool,
) -> String {
    if let Some(variant) = meta.get("variant").and_then(Value::as_str)
        && variant != "adopted"
        && !variant.is_empty()
    {
        return variant_family(variant);
    }
    let runner_type = detect_gpu_runner(platform, llama_dir, vram_gb, nvidia).runner_type;
    if runner_type != "cuda" {
        return runner_type.to_owned();
    }
    match cuda_major_in(llama_dir) {
        0 => "cuda".to_owned(),
        major => format!("cuda-{major}"),
    }
}

/// Whether `installed` already is the build `wanted` would give. A bare "cuda" from before engine.json matches any CUDA build.
pub fn same_family(installed: &str, wanted: &str) -> bool {
    let family = variant_family(wanted);
    installed == family || (!installed.contains('-') && family.split('-').next() == Some(installed))
}

/// Reads the build number from `--version` output, old ("version: 6789 (abc)") or new ("version: 0.25.1 (build 11146, commit abc)"). 0 when absent.
pub fn parse_build(output: &str) -> u64 {
    let from_banner = BUILD_FROM_BANNER
        .as_ref()
        .and_then(|re| re.captures(output))
        .and_then(|captures| captures.get(1))
        .and_then(|m| m.as_str().parse::<u64>().ok());
    let from_old = || {
        BUILD_OLD_BANNER
            .as_ref()
            .and_then(|re| re.captures(output))
            .and_then(|captures| captures.get(1))
            .and_then(|m| m.as_str().parse::<u64>().ok())
    };
    from_banner.or_else(from_old).unwrap_or(0)
}

/// What `llama-server --version` said.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EngineProbe {
    pub ok: bool,
    pub build: u64,
}

/// Runs `llama-server --version` from its own folder: it loads every backend library, so a build that cannot start here
/// fails now rather than when a model loads.
pub async fn probe_engine(
    runner: &impl CommandRunner,
    binary: &Path,
    env: &[(String, String)],
) -> EngineProbe {
    let spec = ProcessSpec {
        program: binary.to_path_buf(),
        args: vec!["--version".to_owned()],
        cwd: binary.parent().map(Path::to_path_buf),
        env: Some(env.to_vec()),
        timeout: PROBE_TIMEOUT,
    };
    match runner.run(spec).await {
        Some(output) => {
            let text = format!("{}\n{}", output.stdout, output.stderr);
            EngineProbe {
                ok: output.success && text.contains("version:"),
                build: parse_build(&text),
            }
        }
        None => EngineProbe {
            ok: false,
            build: 0,
        },
    }
}

/// The environment for running `binary`: the app's own variables, with the GPU runner's paths in front.
pub fn engine_env(
    platform: &Platform,
    user_data: &Path,
    vram_gb: f64,
    binary: &Path,
    nvidia: bool,
) -> Vec<(String, String)> {
    let engine = engine_environment(platform, user_data, vram_gb, Some(binary), nvidia);
    let wanted: HashSet<String> = engine
        .env
        .iter()
        .map(|(key, _)| key.to_uppercase())
        .collect();
    let mut env: Vec<(String, String)> = platform
        .env
        .entries()
        .filter(|(key, _)| !wanted.contains(&key.to_uppercase()))
        .map(|(key, value)| (key.to_owned(), value.to_owned()))
        .collect();
    env.extend(engine.env);
    env
}

/// What a check decided.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateStatus {
    NoEngine,
    Pending,
    Recent,
    Current { tag: Option<String> },
    Staged { tag: String, variant: String },
    Failed { error: String },
}

/// Looks for a better engine and stages it for the next launch. Never touches the running one.
pub async fn check_for_update<R, D, X>(
    kit: &Toolkit<'_, R, D, X>,
    platform: &Platform,
    user_data: &Path,
    vram_gb: f64,
    nvidia: bool,
    force: bool,
    now: i64,
) -> Result<UpdateStatus, BinaryError>
where
    R: CommandRunner,
    D: Downloader,
    X: Extractor,
{
    let llama_dir = platform.engine_dir(user_data);
    let server_path = llama_dir.join(platform.server_name());
    if !server_path.exists() {
        return Ok(UpdateStatus::NoEngine);
    }
    if pending_dir(&llama_dir)
        .join(platform.server_name())
        .exists()
    {
        return Ok(UpdateStatus::Pending);
    }

    let mut meta = read_engine_meta(&llama_dir);
    let last_check = meta
        .get("lastCheck")
        .and_then(Value::as_str)
        .and_then(ms_from_iso)
        .unwrap_or(0);
    if !force && now - last_check < CHECK_EVERY_MS {
        return Ok(UpdateStatus::Recent);
    }

    let gpu = gpu_profile(kit.runner, vram_gb, nvidia).await;
    let releases: Vec<Release> =
        fetch_json(kit.downloader, kit.policy, UPDATE_RELEASES_URL).await?;
    meta.insert("lastCheck".to_owned(), Value::from(iso_from_ms(now)));
    write_engine_meta(&llama_dir, &meta);

    let failed = failed_tags(&meta);
    let release = releases.iter().find(|entry| {
        let published = entry
            .published_at
            .as_deref()
            .and_then(ms_from_iso)
            .unwrap_or(now);
        !entry.draft
            && build_number(&entry.tag_name) > 0
            && !failed.contains(&entry.tag_name)
            && now - published >= SETTLE_MS
            && pick_release_assets(platform.os, platform.arch, &entry.assets, &gpu)
                .main
                .is_some()
    });
    let Some(release) = release else {
        return Ok(UpdateStatus::Current { tag: None });
    };

    let wanted = pick_release_assets(platform.os, platform.arch, &release.assets, &gpu)
        .variant
        .unwrap_or_default();
    let family = installed_family(platform, &llama_dir, &meta, vram_gb, nvidia);
    let have_build = match meta
        .get("tag")
        .and_then(Value::as_str)
        .map_or(0, build_number)
    {
        0 => {
            probe_engine(
                kit.runner,
                &server_path,
                &engine_env(platform, user_data, vram_gb, &server_path, nvidia),
            )
            .await
            .build
        }
        build => build,
    };
    let newer = build_number(&release.tag_name) > have_build;
    let better = !same_family(&family, &wanted);
    if !newer && !better {
        let tag = meta
            .get("tag")
            .and_then(Value::as_str)
            .map_or_else(|| format!("b{have_build}"), str::to_owned);
        return Ok(UpdateStatus::Current { tag: Some(tag) });
    }

    tracing::info!(
        target: "engine.update",
        tag = release.tag_name.as_str(),
        variant = wanted.as_str(),
        have_build,
        family = family.as_str(),
        better,
        "staging engine update"
    );
    let stage = PathBuf::from(format!("{}.update-staging", llama_dir.display()));
    remove_tree(&stage)?;
    let staged = stage_release(
        kit, platform, user_data, &llama_dir, &stage, release, gpu, vram_gb, nvidia, &meta,
        have_build, now,
    )
    .await;
    if let Err(error) = remove_tree(&stage) {
        tracing::warn!(target: "engine.update", kind = ?error.kind(), "update staging folder not removed");
    }
    match staged {
        Ok((tag, variant)) => Ok(UpdateStatus::Staged { tag, variant }),
        Err(error) => {
            tracing::warn!(target: "engine.update", error = %error, "engine update skipped");
            if matches!(
                error,
                BinaryError::NoGpuBackend(_) | BinaryError::DoesNotStart(_)
            ) {
                let mut latest = read_engine_meta(&llama_dir);
                let mut list = failed_tags(&meta);
                list.push(release.tag_name.clone());
                latest.insert("failedTags".to_owned(), tags_value(&list));
                write_engine_meta(&llama_dir, &latest);
            }
            Ok(UpdateStatus::Failed {
                error: error.to_string(),
            })
        }
    }
}

/// Downloads a release into `stage`, checks that it starts, and moves it to the pending folder.
#[allow(clippy::too_many_arguments)]
async fn stage_release<R, D, X>(
    kit: &Toolkit<'_, R, D, X>,
    platform: &Platform,
    user_data: &Path,
    llama_dir: &Path,
    stage: &Path,
    release: &Release,
    gpu: GpuProfile,
    vram_gb: f64,
    nvidia: bool,
    meta: &Map<String, Value>,
    have_build: u64,
    now: i64,
) -> Result<(String, String), BinaryError>
where
    R: CommandRunner,
    D: Downloader,
    X: Extractor,
{
    let downloaded = download_engine(kit, platform, stage, gpu, Some(release), &|_| {}).await?;
    let out_dir = downloaded.out_dir.clone();
    let staged_server = out_dir.join(platform.server_name());
    let runner_type = detect_gpu_runner(platform, &out_dir, vram_gb, nvidia).runner_type;
    let wants_gpu = vram_gb > 0.0 && platform.os != Os::MacOs;
    if wants_gpu && runner_type == "cpu" {
        return Err(BinaryError::NoGpuBackend(downloaded.tag));
    }
    make_executable(&staged_server, platform.os)?;
    let env = engine_env(platform, user_data, vram_gb, &staged_server, nvidia);
    if !probe_engine(kit.runner, &staged_server, &env).await.ok {
        return Err(BinaryError::DoesNotStart(downloaded.tag));
    }

    let previous = match meta.get("tag").and_then(Value::as_str) {
        Some(tag) => Value::from(tag.to_owned()),
        None if have_build > 0 => Value::from(format!("b{have_build}")),
        None => Value::Null,
    };
    let mut record = Map::new();
    record.insert("tag".to_owned(), Value::from(downloaded.tag.clone()));
    record.insert(
        "variant".to_owned(),
        Value::from(downloaded.variant.clone()),
    );
    record.insert("previousTag".to_owned(), previous);
    record.insert("failedTags".to_owned(), tags_value(&failed_tags(meta)));
    record.insert("lastCheck".to_owned(), Value::from(iso_from_ms(now)));
    write_engine_meta(&out_dir, &record);

    remove_tree(&pending_dir(llama_dir))?;
    fs::rename(&out_dir, pending_dir(llama_dir))?;
    tracing::info!(target: "engine.update", tag = downloaded.tag.as_str(), "engine staged for the next launch");
    Ok((downloaded.tag, downloaded.variant))
}

/// The tags a build was refused for, as the list in engine.json.
fn failed_tags(meta: &Map<String, Value>) -> Vec<String> {
    meta.get("failedTags")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

/// The last twenty failed tags as a JSON array.
fn tags_value(tags: &[String]) -> Value {
    let start = tags.len().saturating_sub(FAILED_TAG_LIMIT);
    Value::Array(
        tags[start..]
            .iter()
            .map(|tag| Value::from(tag.clone()))
            .collect(),
    )
}

/// Renames `source` to `target`, retrying while another process holds a file open. Windows reports that as a sharing violation.
pub fn safe_rename(source: &Path, target: &Path) -> io::Result<()> {
    for attempt in 0..10 {
        match fs::rename(source, target) {
            Ok(()) => return Ok(()),
            Err(error) => {
                let busy = error.kind() == io::ErrorKind::PermissionDenied
                    || matches!(error.raw_os_error(), Some(16 | 32));
                if attempt == 9 || !busy {
                    return Err(error);
                }
                std::thread::sleep(Duration::from_millis(25));
            }
        }
    }
    Err(io::Error::other("rename retries exhausted"))
}

/// What applying a staged engine did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplyOutcome {
    pub applied: bool,
    pub tag: Option<String>,
    pub error: Option<String>,
}

/// Swaps a staged engine in. Only safe before anything has started llama-server.
pub fn apply_pending_engine(platform: &Platform, user_data: &Path, now: i64) -> ApplyOutcome {
    let llama_dir = platform.engine_dir(user_data);
    let pending = pending_dir(&llama_dir);
    if !pending.join(platform.server_name()).exists() {
        if let Err(error) = remove_tree(&pending) {
            tracing::warn!(target: "engine.update", kind = ?error.kind(), "pending folder not removed");
        }
        return ApplyOutcome {
            applied: false,
            tag: None,
            error: None,
        };
    }
    let previous = previous_dir(&llama_dir);
    let swap = || -> io::Result<()> {
        remove_tree(&previous)?;
        if llama_dir.exists() {
            safe_rename(&llama_dir, &previous)?;
        }
        if let Err(error) = safe_rename(&pending, &llama_dir) {
            if previous.exists() {
                safe_rename(&previous, &llama_dir)?;
            }
            return Err(error);
        }
        Ok(())
    };
    if let Err(error) = swap() {
        // A locked file leaves both folders as they were; the swap is tried again next launch.
        tracing::warn!(target: "engine.update", kind = ?error.kind(), "could not switch to the staged engine yet");
        return ApplyOutcome {
            applied: false,
            tag: None,
            error: Some(error.to_string()),
        };
    }
    let mut meta = read_engine_meta(&llama_dir);
    meta.insert("installedAt".to_owned(), Value::from(iso_from_ms(now)));
    meta.insert("unconfirmed".to_owned(), Value::Bool(true));
    write_engine_meta(&llama_dir, &meta);
    let tag = meta.get("tag").and_then(Value::as_str).map(str::to_owned);
    tracing::info!(target: "engine.update", tag = tag.as_deref().unwrap_or("staged build"), "switched the engine");
    ApplyOutcome {
        applied: true,
        tag,
        error: None,
    }
}

fn is_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        Value::String(text) => !text.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// Whether the engine in place was swapped in and has not yet loaded a model.
pub fn is_unconfirmed(platform: &Platform, user_data: &Path) -> bool {
    let llama_dir = platform.engine_dir(user_data);
    let flagged = read_engine_meta(&llama_dir)
        .get("unconfirmed")
        .is_some_and(is_truthy);
    flagged && previous_dir(&llama_dir).exists()
}

/// A model loaded on the new engine: it stays, and the old one goes. False when there was nothing to confirm.
pub fn confirm_engine(platform: &Platform, user_data: &Path) -> bool {
    let llama_dir = platform.engine_dir(user_data);
    let mut meta = read_engine_meta(&llama_dir);
    if !meta.get("unconfirmed").is_some_and(is_truthy) {
        return false;
    }
    meta.remove("unconfirmed");
    write_engine_meta(&llama_dir, &meta);
    if let Err(error) = remove_tree(&previous_dir(&llama_dir)) {
        tracing::warn!(target: "engine.update", kind = ?error.kind(), "previous engine not removed");
    }
    true
}

/// What a rollback did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RollbackOutcome {
    pub rolled_back: bool,
    pub tag: Option<String>,
    pub error: Option<String>,
}

/// The first load on a new engine crashed: bring the old engine back and never offer that build again.
pub fn rollback_engine(platform: &Platform, user_data: &Path) -> RollbackOutcome {
    let llama_dir = platform.engine_dir(user_data);
    if !is_unconfirmed(platform, user_data) {
        return RollbackOutcome {
            rolled_back: false,
            tag: None,
            error: None,
        };
    }
    let bad_tag = read_engine_meta(&llama_dir)
        .get("tag")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let failed = failed_dir(&llama_dir);
    let restore = || -> io::Result<()> {
        remove_tree(&failed)?;
        safe_rename(&llama_dir, &failed)?;
        if let Err(error) = safe_rename(&previous_dir(&llama_dir), &llama_dir) {
            if failed.exists() {
                safe_rename(&failed, &llama_dir)?;
            }
            return Err(error);
        }
        remove_tree(&failed)?;
        Ok(())
    };
    if let Err(error) = restore() {
        tracing::error!(target: "engine.update", kind = ?error.kind(), "could not restore the previous engine");
        return RollbackOutcome {
            rolled_back: false,
            tag: None,
            error: Some(error.to_string()),
        };
    }
    let mut meta = read_engine_meta(&llama_dir);
    let mut tags = failed_tags(&meta);
    tags.extend(bad_tag.clone());
    let mut unique: Vec<String> = Vec::new();
    for tag in tags {
        if !unique.contains(&tag) {
            unique.push(tag);
        }
    }
    meta.insert("failedTags".to_owned(), tags_value(&unique));
    meta.remove("unconfirmed");
    write_engine_meta(&llama_dir, &meta);
    tracing::warn!(target: "engine.update", bad_tag = bad_tag.as_deref().unwrap_or("update"), "engine failed its first load, rolled back");
    RollbackOutcome {
        rolled_back: true,
        tag: bad_tag,
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::binary_manager::META_FILE;
    use crate::platform::{Arch, Env};

    #[test]
    fn builds_compare_by_what_they_run_on() {
        assert_eq!(variant_family("cuda-12.4"), "cuda-12");
        assert_eq!(variant_family("rocm-10.0"), "rocm");
        assert!(same_family("cuda-12", "cuda-12.8"));
        assert!(!same_family("cuda-12", "cuda-13.4"));
        assert!(!same_family("vulkan", "cuda-12.4"));
        assert!(same_family("cuda", "cuda-13.4"));
    }

    #[test]
    fn the_build_is_read_from_both_banner_formats() {
        assert_eq!(
            parse_build("version: 0.25.1 (build 11146, commit a1b2c3)\nbuilt with gcc"),
            11146
        );
        assert_eq!(parse_build("version: 6789 (a1b2c3)\nbuilt with MSVC"), 6789);
        assert_eq!(parse_build("usage: llama-server"), 0);
    }

    #[test]
    fn a_swap_is_kept_until_a_model_loads_and_then_dropped() {
        let root = tempfile::tempdir().expect("temp dir");
        let platform = Platform::new(Os::Linux, Arch::X64, Env::default());
        let llama = platform.engine_dir(root.path());
        write_engine(&llama, r#"{"tag":"b100"}"#);
        write_engine(
            &pending_dir(&llama),
            r#"{"tag":"b200","previousTag":"b100"}"#,
        );

        let applied = apply_pending_engine(&platform, root.path(), 0);
        assert_eq!(
            applied,
            ApplyOutcome {
                applied: true,
                tag: Some("b200".to_owned()),
                error: None
            }
        );
        assert_eq!(
            read_engine_meta(&llama).get("tag").and_then(Value::as_str),
            Some("b200")
        );
        assert!(is_unconfirmed(&platform, root.path()));
        assert!(!pending_dir(&llama).exists());

        assert!(confirm_engine(&platform, root.path()));
        assert!(!is_unconfirmed(&platform, root.path()));
        assert!(!previous_dir(&llama).exists());
    }

    #[test]
    fn a_crashed_first_load_brings_the_old_engine_back_and_blocks_the_build() {
        let root = tempfile::tempdir().expect("temp dir");
        let platform = Platform::new(Os::Linux, Arch::X64, Env::default());
        let llama = platform.engine_dir(root.path());
        write_engine(&llama, r#"{"tag":"b100"}"#);
        write_engine(&pending_dir(&llama), r#"{"tag":"b200"}"#);
        apply_pending_engine(&platform, root.path(), 0);

        let rolled = rollback_engine(&platform, root.path());
        assert_eq!(
            rolled,
            RollbackOutcome {
                rolled_back: true,
                tag: Some("b200".to_owned()),
                error: None
            }
        );
        let meta = read_engine_meta(&llama);
        assert_eq!(meta.get("tag").and_then(Value::as_str), Some("b100"));
        assert_eq!(failed_tags(&meta), vec!["b200".to_owned()]);
        assert!(!is_unconfirmed(&platform, root.path()));
        assert!(!rollback_engine(&platform, root.path()).rolled_back);
    }

    #[test]
    fn nothing_is_applied_without_a_complete_staged_engine() {
        let root = tempfile::tempdir().expect("temp dir");
        let platform = Platform::new(Os::Linux, Arch::X64, Env::default());
        write_engine(&platform.engine_dir(root.path()), r#"{"tag":"b100"}"#);
        assert!(!apply_pending_engine(&platform, root.path(), 0).applied);
    }

    #[test]
    fn the_cuda_major_is_read_from_the_runtime_library() {
        let dir = tempfile::tempdir().expect("temp dir");
        fs::write(dir.path().join("cudart64_13.dll"), "x").expect("write");
        assert_eq!(cuda_major_in(dir.path()), 13);
        let empty = tempfile::tempdir().expect("temp dir");
        assert_eq!(cuda_major_in(empty.path()), 0);
    }

    fn write_engine(dir: &Path, meta: &str) {
        fs::create_dir_all(dir).expect("create engine dir");
        fs::write(dir.join("llama-server"), "x").expect("write server");
        fs::write(dir.join(META_FILE), meta).expect("write meta");
    }
}
