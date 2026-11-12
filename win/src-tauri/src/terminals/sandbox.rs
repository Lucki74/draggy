//! Runs a command through the Windows sandbox launcher (win/sandbox): an AppContainer that sees one project
//! folder. The launcher fails closed, and so does this.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::future::Future;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex, PoisonError};

use draggy_tools::sandbox::scrub_env;
use draggy_tools::spawn::hidden_command;
use serde_json::{Value, json};
use sha1::{Digest, Sha1};

const LAUNCHER: &str = "draggy-sandbox.exe";
// Without these, Node cannot resolve a script path when the drive root is not stat-able.
const NODE_FLAGS: &str = "--preserve-symlinks --preserve-symlinks-main";
const UNAVAILABLE: &str = "The sandbox is not available, so the command was not run.";
const SECRET_FOLDERS: [&str; 5] = [".ssh", ".aws", ".gnupg", ".azure", ".config"];

/// What a sandboxed command may reach. `launcher` is the launcher binary when one was found.
#[derive(Clone, Debug, Default)]
pub struct Options {
    pub project: PathBuf,
    pub data_dir: PathBuf,
    pub chat_key: String,
    pub launcher: Option<PathBuf>,
    pub network: bool,
    pub writable: bool,
    pub extras: Extras,
}

/// Extra folders and environment a caller adds, such as the bundled Python.
#[derive(Clone, Debug, Default)]
pub struct Extras {
    pub read_only: Vec<PathBuf>,
    pub path: Vec<PathBuf>,
    pub env: Vec<(String, String)>,
}

/// The program a command starts with, before the sandbox wraps it.
pub struct Spawn<'a> {
    pub file: &'a Path,
    pub args: &'a [String],
    pub verbatim: bool,
    pub cwd: &'a Path,
    pub env: &'a BTreeMap<String, String>,
}

/// The access a launch needs, granted once per app run before its first command.
#[derive(Clone, Debug)]
pub struct Grant {
    pub key: String,
    pub spec: Value,
    pub specs: PathBuf,
}

/// What to start: the launcher with its spec when sandboxed, else the program itself.
#[derive(Clone, Debug)]
pub struct Launch {
    pub file: PathBuf,
    pub args: Vec<String>,
    pub verbatim: bool,
    pub cwd: PathBuf,
    pub env: BTreeMap<String, String>,
    pub grant: Option<Grant>,
}

impl Launch {
    /// A plain launch with no sandbox.
    pub fn direct(spawn: &Spawn<'_>) -> Self {
        Self {
            file: spawn.file.to_path_buf(),
            args: spawn.args.to_vec(),
            verbatim: spawn.verbatim,
            cwd: spawn.cwd.to_path_buf(),
            env: spawn.env.clone(),
            grant: None,
        }
    }
}

/// The launcher binary: packaged next to the app's resources, else the dev build.
pub fn launcher(resource_dir: Option<&Path>) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(dir) = resource_dir {
        candidates.push(dir.join("sandbox").join(LAUNCHER));
    }
    candidates.push(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("sandbox")
            .join("target")
            .join("release")
            .join(LAUNCHER),
    );
    candidates.into_iter().find(|path| path.is_file())
}

/// Resolves symlinks and 8.3 names; the path as given when it cannot be resolved.
fn real(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// The resolved path as text, without the `\\?\` prefix Windows adds.
fn plain_text(path: &Path) -> String {
    let text = real(path).display().to_string();
    text.strip_prefix(r"\\?\")
        .map_or(text.clone(), str::to_owned)
}

pub fn inside(root: &Path, target: &Path) -> bool {
    real(target).starts_with(real(root))
}

/// One container per project and access level, so a read-only chat never holds write rights.
pub fn identity(project: &Path, writable: bool) -> String {
    let digest = Sha1::digest(plain_text(project).to_lowercase().as_bytes());
    let key: String = digest
        .iter()
        .take(6)
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!("p{key}-{}", if writable { "rw" } else { "ro" })
}

/// The Windows command line CreateProcess expects, quoting each argument by the MSVCRT rules.
pub fn quote_arg(value: &str) -> String {
    if !value.is_empty() && !value.chars().any(|c| c.is_whitespace() || c == '"') {
        return value.to_owned();
    }
    let mut out = String::from("\"");
    let mut slashes = 0usize;
    for ch in value.chars() {
        if ch == '\\' {
            slashes += 1;
            continue;
        }
        if ch == '"' {
            out.push_str(&"\\".repeat(slashes * 2 + 1));
        } else {
            out.push_str(&"\\".repeat(slashes));
        }
        out.push(ch);
        slashes = 0;
    }
    out.push_str(&"\\".repeat(slashes * 2));
    out.push('"');
    out
}

/// The command line for a program and its arguments. A verbatim command is passed through as written.
pub fn command_line(file: &Path, args: &[String], verbatim: bool) -> String {
    let head = quote_arg(&file.display().to_string());
    let rest = if verbatim {
        args.join(" ")
    } else {
        args.iter()
            .map(|arg| quote_arg(arg))
            .collect::<Vec<_>>()
            .join(" ")
    };
    if rest.is_empty() {
        head
    } else {
        format!("{head} {rest}")
    }
}

/// The program's own folder, which the sandbox may read so the program can start. Drive roots, the home folder,
/// Windows and secret folders give nothing, so the user's other tools and credentials stay hidden.
pub fn toolchain_folders(file: &Path, home: Option<&Path>, system_root: &Path) -> Vec<PathBuf> {
    let Some(folder) = file.parent() else {
        return Vec::new();
    };
    let resolved = real(folder);
    if resolved.parent().is_none() || home.is_some_and(|home| resolved == real(home)) {
        return Vec::new();
    }
    if resolved.starts_with(real(system_root)) {
        return Vec::new();
    }
    let secret = resolved.components().any(|part| {
        matches!(part, Component::Normal(name) if SECRET_FOLDERS.iter().any(|secret| name.eq_ignore_ascii_case(secret)))
    });
    if secret {
        Vec::new()
    } else {
        vec![folder.to_path_buf()]
    }
}

fn make_dirs(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|error| error.to_string())
}

fn random_name() -> Result<String, String> {
    let mut bytes = [0u8; 8];
    getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn system_root() -> PathBuf {
    std::env::var_os("SystemRoot").map_or_else(|| PathBuf::from(r"C:\Windows"), PathBuf::from)
}

/// Turns a spawn into one that goes through the launcher. Errors when the sandbox cannot be used, so nothing runs.
pub fn wrap(spawn: &Spawn<'_>, options: &Options) -> Result<Launch, String> {
    let Some(launcher) = options.launcher.clone() else {
        return Err(UNAVAILABLE.into());
    };
    if !options.project.exists() {
        return Err("The project folder is not available.".into());
    }
    if !inside(&options.project, spawn.cwd) {
        return Err("The command's folder is outside the project.".into());
    }

    let chat = options
        .chat_key
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '_' | '.' | '-') {
                c
            } else {
                '_'
            }
        })
        .collect::<String>();
    let scratch = options.data_dir.join("sandbox").join("scratch").join(chat);
    let (tmp, cache) = (scratch.join("tmp"), scratch.join("cache"));
    make_dirs(&tmp)?;
    make_dirs(&cache)?;
    let specs = options.data_dir.join("sandbox").join("specs");
    make_dirs(&specs)?;

    let mut env: BTreeMap<String, String> = scrub_env(
        spawn
            .env
            .iter()
            .map(|(name, value)| (name.clone(), value.clone())),
    )
    .into_iter()
    .collect();
    if !options.extras.path.is_empty() {
        let key = env
            .keys()
            .find(|name| name.eq_ignore_ascii_case("path"))
            .cloned()
            .unwrap_or_else(|| "PATH".into());
        let mut parts: Vec<String> = options
            .extras
            .path
            .iter()
            .map(|p| p.display().to_string())
            .collect();
        if let Some(current) = env.get(&key).filter(|value| !value.is_empty()) {
            parts.push(current.clone());
        }
        env.insert(key, parts.join(";"));
    }
    env.extend(options.extras.env.iter().cloned());
    let tmp_text = tmp.display().to_string();
    env.insert("TEMP".into(), tmp_text.clone());
    env.insert("TMP".into(), tmp_text);
    env.insert(
        "npm_config_cache".into(),
        cache.join("npm").display().to_string(),
    );
    env.insert(
        "PIP_CACHE_DIR".into(),
        cache.join("pip").display().to_string(),
    );
    let node_options = match env.get("NODE_OPTIONS").filter(|value| !value.is_empty()) {
        Some(value) => format!("{value} {NODE_FLAGS}"),
        None => NODE_FLAGS.into(),
    };
    env.insert("NODE_OPTIONS".into(), node_options);

    let home = std::env::var_os("USERPROFILE").map(PathBuf::from);
    let mut read_only = toolchain_folders(spawn.file, home.as_deref(), &system_root());
    read_only.extend(options.extras.read_only.iter().cloned());
    let mut read_write = vec![scratch.clone()];
    if options.writable {
        read_write.insert(0, options.project.clone());
    } else {
        read_only.push(options.project.clone());
    }
    let identity = identity(&options.project, options.writable);
    let as_text = |paths: &[PathBuf]| {
        paths
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
    };
    let (read_only_text, read_write_text) = (as_text(&read_only), as_text(&read_write));
    let cwd_text = spawn.cwd.display().to_string();
    let spec = json!({
        "identity": identity,
        "cwd": cwd_text,
        "readOnly": read_only_text,
        "readWrite": read_write_text,
        "network": options.network,
        "env": env.iter().map(|(name, value)| json!([name, value])).collect::<Vec<_>>(),
        "commandLine": command_line(spawn.file, spawn.args, spawn.verbatim),
    });
    let spec_file = specs.join(format!("{}.json", random_name()?));
    fs::write(&spec_file, spec.to_string()).map_err(|error| error.to_string())?;

    let mut launcher_env = BTreeMap::new();
    for name in ["SystemRoot", "LOCALAPPDATA"] {
        if let Ok(value) = std::env::var(name) {
            launcher_env.insert(name.to_owned(), value);
        }
    }
    launcher_env.insert("TEMP".into(), std::env::temp_dir().display().to_string());
    let access = json!({
        "identity": identity,
        "cwd": cwd_text,
        "readOnly": read_only_text,
        "readWrite": read_write_text,
        "commandLine": "grant",
    });
    let key = serde_json::to_string(&json!([identity, read_only_text, read_write_text]))
        .map_err(|error| error.to_string())?;
    Ok(Launch {
        file: launcher,
        args: vec![spec_file.display().to_string()],
        verbatim: false,
        cwd: spawn.cwd.to_path_buf(),
        env: launcher_env,
        grant: Some(Grant {
            key,
            spec: access,
            specs,
        }),
    })
}

/// Grants already made this app run, by key.
static DONE: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));
/// One lock per key, so concurrent first commands wait for the same grant instead of starting two.
static GRANTS: LazyLock<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn is_done(key: &str) -> bool {
    DONE.lock()
        .unwrap_or_else(PoisonError::into_inner)
        .contains(key)
}

/// True while a launch still waits on its first grant this app run.
pub fn needs_grant(launch: &Launch) -> bool {
    launch
        .grant
        .as_ref()
        .is_some_and(|grant| !is_done(&grant.key))
}

/// Grants a launch's folders once per app run, with no timeout: the first grant on a big project can take minutes.
/// A failed grant is not remembered, so the next command tries again.
pub async fn ready(launch: &Launch) -> Result<(), String> {
    ready_with(launch, default_grant).await
}

async fn ready_with<F, Fut>(launch: &Launch, grant_with: F) -> Result<(), String>
where
    F: FnOnce(Launch) -> Fut,
    Fut: Future<Output = Result<(), String>>,
{
    let Some(grant) = launch.grant.as_ref() else {
        return Ok(());
    };
    if is_done(&grant.key) {
        return Ok(());
    }
    let cell = {
        let mut map = GRANTS.lock().unwrap_or_else(PoisonError::into_inner);
        Arc::clone(map.entry(grant.key.clone()).or_default())
    };
    let _turn = cell.lock().await;
    if is_done(&grant.key) {
        return Ok(());
    }
    let key = grant.key.clone();
    grant_with(launch.clone()).await?;
    DONE.lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(key);
    Ok(())
}

async fn default_grant(launch: Launch) -> Result<(), String> {
    let Some(grant) = launch.grant.as_ref() else {
        return Ok(());
    };
    make_dirs(&grant.specs)?;
    let spec_file = grant.specs.join(format!("{}.json", random_name()?));
    fs::write(&spec_file, grant.spec.to_string()).map_err(|error| error.to_string())?;
    let spec_arg = spec_file.display().to_string();
    let output = hidden_command(&launch.file, &["--grant", spec_arg.as_str()], |command| {
        command.env_clear().envs(&launch.env);
    })
    .output()
    .await
    .map_err(|error| error.to_string())?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    Err(if stderr.is_empty() {
        output.status.to_string()
    } else {
        stderr
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quote_arg_follows_msvcrt_rules() {
        assert_eq!(quote_arg("plain"), "plain");
        assert_eq!(quote_arg("a b"), "\"a b\"");
        assert_eq!(quote_arg("say \"hi\""), "\"say \\\"hi\\\"\"");
    }

    #[test]
    fn identity_names_the_folder_and_mode() {
        let rw = identity(Path::new("C:/Work/App"), true);
        assert!(rw.starts_with('p') && rw.ends_with("-rw"));
        assert_eq!(rw.len(), 1 + 12 + 3);
        assert_eq!(identity(Path::new("C:/work/app"), true), rw);
        assert!(identity(Path::new("C:/Work/App"), false).ends_with("-ro"));
    }

    #[test]
    fn wrap_refuses_a_folder_outside_the_project() {
        let options = Options {
            project: std::env::temp_dir(),
            data_dir: std::env::temp_dir(),
            chat_key: "c".into(),
            launcher: Some(PathBuf::from("draggy-sandbox.exe")),
            network: false,
            writable: true,
            extras: Extras::default(),
        };
        let env = BTreeMap::new();
        let spawn = Spawn {
            file: Path::new("cmd.exe"),
            args: &[],
            verbatim: false,
            cwd: Path::new("C:/Windows"),
            env: &env,
        };
        let error = wrap(&spawn, &options).err().unwrap_or_default();
        assert_eq!(error, "The command's folder is outside the project.");
    }

    #[test]
    fn toolchain_folders_skip_home_system_and_secret_folders() {
        let file = Path::new("C:/tools/node/bin/node.exe");
        assert_eq!(
            toolchain_folders(file, None, Path::new("C:/Windows")).len(),
            1
        );
        let home = Path::new("C:/tools/node/bin");
        assert!(toolchain_folders(file, Some(home), Path::new("C:/Windows")).is_empty());
        let system = Path::new("C:/Windows/System32/cmd.exe");
        assert!(toolchain_folders(system, None, Path::new("C:/Windows")).is_empty());
        let secret = Path::new("C:/Users/me/.ssh/tool.exe");
        assert!(toolchain_folders(secret, None, Path::new("C:/Windows")).is_empty());
    }

    #[test]
    fn extras_path_joins_the_child_path() {
        let project = std::env::temp_dir();
        let options = Options {
            project: project.clone(),
            data_dir: project.clone(),
            chat_key: "c".into(),
            launcher: Some(PathBuf::from("draggy-sandbox.exe")),
            network: false,
            writable: true,
            extras: Extras {
                read_only: Vec::new(),
                path: vec![PathBuf::from("C:/dg/python")],
                env: Vec::new(),
            },
        };
        let env = BTreeMap::from([("PATH".to_owned(), "C:/base".to_owned())]);
        let spawn = Spawn {
            file: Path::new("cmd.exe"),
            args: &[],
            verbatim: false,
            cwd: &project,
            env: &env,
        };
        let launch = wrap(&spawn, &options).expect("wrap");
        let text = fs::read_to_string(&launch.args[0]).expect("spec file");
        let spec: Value = serde_json::from_str(&text).expect("spec json");
        let child_env = spec["env"].as_array().expect("env");
        assert!(child_env.iter().any(|pair| {
            pair[0]
                .as_str()
                .is_some_and(|name| name.eq_ignore_ascii_case("path"))
                && pair[1]
                    .as_str()
                    .is_some_and(|value| value.contains("C:/dg/python"))
        }));
    }

    #[tokio::test]
    async fn grant_runs_once_per_key_and_retries_failures() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let launch = Launch {
            file: PathBuf::from("draggy-sandbox.exe"),
            args: Vec::new(),
            verbatim: false,
            cwd: std::env::temp_dir(),
            env: BTreeMap::new(),
            grant: Some(Grant {
                key: format!("retry-{}", std::process::id()),
                spec: json!({}),
                specs: std::env::temp_dir(),
            }),
        };
        let calls = Arc::new(AtomicUsize::new(0));
        let counted = Arc::clone(&calls);
        let first = ready_with(&launch, move |_: Launch| async move {
            if counted.fetch_add(1, Ordering::SeqCst) == 0 {
                Err("denied".to_owned())
            } else {
                Ok(())
            }
        })
        .await;
        assert_eq!(first, Err("denied".to_owned()));
        let counted = Arc::clone(&calls);
        let second = ready_with(&launch, move |_: Launch| async move {
            counted.fetch_add(1, Ordering::SeqCst);
            Ok(())
        })
        .await;
        assert!(second.is_ok());
        let third = ready_with(&launch, |_: Launch| async {
            Err::<(), String>("grant ran again".to_owned())
        })
        .await;
        assert!(third.is_ok());
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    #[ignore = "needs draggy-sandbox.exe next to the app"]
    fn launcher_is_found_when_bundled() {
        assert!(launcher(None).is_some());
    }
}
