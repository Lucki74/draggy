//! Runs a command through the Windows sandbox launcher (win/sandbox): an AppContainer that sees one project
//! folder. The launcher fails closed, and so does this.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs;
use std::future::Future;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex, PoisonError};
use std::time::{Duration, Instant};

use draggy_tools::sandbox::scrub_env;
use draggy_tools::spawn::hidden_command;
use serde_json::{Value, json};
use sha1::{Digest, Sha1};

use super::diag;
use super::elevate;

const LAUNCHER: &str = "draggy-sandbox.exe";
const SCOPE: &str = "proc.sandbox";
// Without these, Node cannot resolve a script path when the drive root is not stat-able.
const NODE_FLAGS: &str = "--preserve-symlinks --preserve-symlinks-main";
const UNAVAILABLE: &str = "The sandbox is not available, so the command was not run.";
const SECRET_FOLDERS: [&str; 5] = [".ssh", ".aws", ".gnupg", ".azure", ".config"];
/// Printed by the shell check; a shell that starts and runs a command prints it back.
pub const SHELL_MARK: &str = "dg-shell-ok";
/// Written into the output while the first grant runs, before the command's own output.
pub const SETUP_NOTE: &str = "Setting up the sandbox for this folder. The first time can take a few minutes on a big project, and Windows may ask once for administrator rights so commands can list the folders above it.\n";
/// The launcher's report of a folder above the project that only an administrator can open to listing.
const NEEDS_ADMIN: &str = "sandbox: needs-admin: ";
/// The launcher's report of a toolchain folder, such as C:\Program Files\nodejs, that only an administrator can open.
const NEEDS_ADMIN_READ: &str = "sandbox: needs-admin-read: ";

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
    pub cid: String,
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

/// Variables that name a CA bundle. Antivirus software often keeps it where the sandbox cannot read.
const CA_VARS: [&str; 5] = [
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
    "GIT_SSL_CAINFO",
];

/// Copies each named CA bundle into the sandbox's cache and points its variable at the copy.
fn copy_ca_bundles(env: &mut BTreeMap<String, String>, dir: &Path) {
    for (index, name) in CA_VARS.iter().enumerate() {
        let Some(source) = env
            .get(*name)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
        else {
            continue;
        };
        let copy = dir.join(format!("{index}.pem"));
        let copied = make_dirs(dir).is_ok() && std::fs::copy(&source, &copy).is_ok();
        if copied {
            env.insert((*name).to_owned(), copy.display().to_string());
        } else {
            env.remove(*name);
        }
    }
}

fn system_root() -> PathBuf {
    std::env::var_os("SystemRoot").map_or_else(|| PathBuf::from(r"C:\Windows"), PathBuf::from)
}

/// Turns a spawn into one that goes through the launcher. Errors when the sandbox cannot be used, so nothing runs.
pub fn wrap(spawn: &Spawn<'_>, options: &Options) -> Result<Launch, String> {
    let cid = options.chat_key.clone();
    let Some(launcher) = options.launcher.clone() else {
        log_warn(
            "launcher missing",
            json!({ "cid": cid, "reason": "unavailable" }),
        );
        return Err(UNAVAILABLE.into());
    };
    if !options.project.exists() {
        log_warn("refused", json!({ "cid": cid, "reason": "no-project" }));
        return Err("The project folder is not available.".into());
    }
    if !inside(&options.project, spawn.cwd) {
        log_warn(
            "refused",
            json!({ "cid": cid, "reason": "cwd-outside-project" }),
        );
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
    copy_ca_bundles(&mut env, &cache.join("certs"));

    let home = std::env::var_os("USERPROFILE").map(PathBuf::from);
    let mut read_only = toolchain_folders(spawn.file, home.as_deref(), &system_root());
    read_only.extend(options.extras.read_only.iter().cloned());
    // Tools such as node, npm and git live in PATH folders, which the container must be able to read.
    let path = env
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("path"));
    for dir in path.map_or_else(Vec::new, |(_, value)| {
        std::env::split_paths(value).collect()
    }) {
        if !dir.is_dir() {
            continue;
        }
        for folder in toolchain_folders(&dir.join("tool"), home.as_deref(), &system_root()) {
            if !read_only.iter().any(|known| real(known) == real(&folder)) {
                read_only.push(folder);
            }
        }
    }
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
    log_debug(
        "launch",
        json!({
            "cid": cid,
            "identity": identity,
            "access": if options.writable { "rw" } else { "ro" },
            "network": options.network,
            "readOnly": read_only_text.len(),
            "readWrite": read_write_text.len(),
            "program": spawn.file.file_name().map(|name| name.to_string_lossy().into_owned()),
        }),
    );

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
            cid,
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

fn log_debug(message: &str, data: Value) {
    if let Some(diag) = diag() {
        diag.debug(SCOPE, message, Some(data));
    }
}

fn log_info(message: &str, data: Value) {
    if let Some(diag) = diag() {
        diag.info(SCOPE, message, Some(data));
    }
}

fn log_warn(message: &str, data: Value) {
    if let Some(diag) = diag() {
        diag.warn(SCOPE, message, Some(data));
    }
}

fn log_error(message: &str, data: Value) {
    if let Some(diag) = diag() {
        diag.error(SCOPE, message, Some(data));
    }
}

/// Splits the launcher's stderr into the folders that need an administrator and the other lines. Folders to open
/// for reading follow a `--read` marker, as the launcher's `--list-folders` mode takes them.
fn split_stderr(stderr: &str) -> (Vec<String>, Vec<String>) {
    let lines: Vec<String> = stderr
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect();
    let (admin, rest): (Vec<String>, Vec<String>) = lines
        .into_iter()
        .partition(|line| line.starts_with(NEEDS_ADMIN) || line.starts_with(NEEDS_ADMIN_READ));
    let mut folders: Vec<String> = admin
        .iter()
        .filter_map(|line| line.strip_prefix(NEEDS_ADMIN).map(str::to_owned))
        .collect();
    let read: Vec<String> = admin
        .iter()
        .filter_map(|line| line.strip_prefix(NEEDS_ADMIN_READ).map(str::to_owned))
        .collect();
    if !read.is_empty() {
        folders.push("--read".to_owned());
        folders.extend(read);
    }
    (folders, rest)
}

async fn default_grant(launch: Launch) -> Result<(), String> {
    let Some(grant) = launch.grant.as_ref() else {
        return Ok(());
    };
    make_dirs(&grant.specs)?;
    let spec_file = grant.specs.join(format!("{}.json", random_name()?));
    fs::write(&spec_file, grant.spec.to_string()).map_err(|error| error.to_string())?;
    let spec_arg = spec_file.display().to_string();
    let started = Instant::now();
    let output = hidden_command(&launch.file, &["--grant", spec_arg.as_str()], |command| {
        command.env_clear().envs(&launch.env);
    })
    .output()
    .await;
    // The spec holds the environment, so it goes as soon as the launcher has read it.
    let _ = fs::remove_file(&spec_file);
    let output = output.map_err(|error| error.to_string())?;
    // The launcher warns on stderr even when it succeeds, for a folder it could not grant.
    let (admin, rest) = split_stderr(&String::from_utf8_lossy(&output.stderr));
    let data = json!({
        "cid": grant.cid,
        "identity": grant.spec["identity"],
        "durMs": u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
        "readOnly": grant.spec["readOnly"].as_array().map_or(0, Vec::len),
        "readWrite": grant.spec["readWrite"].as_array().map_or(0, Vec::len),
        "warnings": rest.len(),
        "needsAdmin": admin.len(),
    });
    if !output.status.success() {
        log_error("grant failed", data);
        let message = rest.join(" ");
        return Err(if message.is_empty() {
            output.status.to_string()
        } else {
            message
        });
    }
    if rest.is_empty() {
        log_info("granted", data);
    } else {
        log_warn("grant warned", data);
    }
    if !admin.is_empty() {
        list_folders(&launch, admin).await;
    }
    Ok(())
}

/// Lets every container list folders such as C:\Users and C:\ through Draggy's list capability. It needs one UAC
/// prompt per machine. It is asked at most once per app run, so a declined prompt does not come back on every command.
async fn list_folders(launch: &Launch, folders: Vec<String>) {
    let file = launch.file.clone();
    list_folders_with(launch, folders, move |folders| {
        default_elevate(file, folders)
    })
    .await;
}

static ADMIN_STEP: LazyLock<tokio::sync::OnceCell<()>> = LazyLock::new(tokio::sync::OnceCell::new);

async fn list_folders_with<F, Fut>(launch: &Launch, folders: Vec<String>, elevate: F)
where
    F: FnOnce(Vec<String>) -> Fut,
    Fut: Future<Output = Value>,
{
    let cid = launch.grant.as_ref().map(|grant| grant.cid.clone());
    ADMIN_STEP
        .get_or_init(|| async move {
            let mut unique: Vec<String> = Vec::new();
            for folder in folders {
                if !unique.contains(&folder) {
                    unique.push(folder);
                }
            }
            let count = unique.len();
            log_info(
                "asking for admin to list parent folders",
                json!({ "cid": cid, "folders": count }),
            );
            let result = elevate(unique).await;
            if result["declined"] == json!(true) {
                log_warn("admin step declined", json!({ "folders": count }));
            } else if result["success"] == json!(true) {
                log_info("parent folders listable", json!({ "folders": count }));
            } else {
                log_warn(
                    "admin step failed",
                    json!({ "exitCode": result["exitCode"], "timedOut": result["timedOut"] == json!(true) }),
                );
            }
        })
        .await;
}

async fn default_elevate(file: PathBuf, folders: Vec<String>) -> Value {
    // Paths that cmd would expand or split are never sent to the elevated batch file.
    let safe: Vec<String> = folders
        .into_iter()
        .filter(|folder| !folder.chars().any(|c| "%&^|<>\"\r\n".contains(c)))
        .collect();
    if safe.is_empty() {
        return json!({ "success": false });
    }
    let mut args = vec!["--list-folders".to_owned()];
    args.extend(safe);
    let command = command_line(&file, &args, false);
    elevate::run_elevated(&command, &std::env::temp_dir(), Some(10.0 * 60.0 * 1000.0)).await
}

/// Shells that passed the check this app run, for callers that cannot wait on one.
static PROVEN: LazyLock<Mutex<BTreeSet<String>>> = LazyLock::new(|| Mutex::new(BTreeSet::new()));
/// One lock and result per sandbox identity and shell, so each shell is checked once.
type ShellCheck = Arc<tokio::sync::Mutex<Option<bool>>>;
static SHELL_CHECKS: LazyLock<Mutex<HashMap<String, ShellCheck>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// True once `shell` started inside this launch's container and ran `echo` there. Each shell is checked once per
/// sandbox identity and app run, after the folder grant, since Git's bash and PowerShell can fail to start in an
/// AppContainer where cmd works.
pub async fn shell_works(launch: &Launch, shell: &str) -> bool {
    shell_works_with(launch, shell, default_shell_check).await
}

async fn shell_works_with<F, Fut>(launch: &Launch, shell: &str, check: F) -> bool
where
    F: FnOnce(Launch) -> Fut,
    Fut: Future<Output = bool>,
{
    let identity = launch
        .grant
        .as_ref()
        .map_or(Value::Null, |grant| grant.spec["identity"].clone());
    let key = json!([identity, shell]).to_string();
    let cell = {
        let mut map = SHELL_CHECKS.lock().unwrap_or_else(PoisonError::into_inner);
        Arc::clone(map.entry(key).or_default())
    };
    let mut known = cell.lock().await;
    if let Some(works) = *known {
        return works;
    }
    let started = Instant::now();
    let works = match ready(launch).await {
        Ok(()) => check(launch.clone()).await,
        Err(_) => false,
    };
    let message = if works {
        "shell works in the sandbox"
    } else {
        "shell does not start in the sandbox"
    };
    log_info(
        message,
        json!({
            "cid": launch.grant.as_ref().map(|grant| grant.cid.clone()),
            "identity": identity,
            "shell": shell,
            "durMs": u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
        }),
    );
    if works {
        PROVEN
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(shell.to_owned());
    }
    *known = Some(works);
    works
}

/// The shells that passed the check this app run.
pub fn proven_shells() -> Vec<String> {
    PROVEN
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .iter()
        .cloned()
        .collect()
}

async fn default_shell_check(launch: Launch) -> bool {
    let run = hidden_command(&launch.file, launch.args.as_slice(), |command| {
        command
            .env_clear()
            .envs(&launch.env)
            .current_dir(&launch.cwd);
    })
    .output();
    match tokio::time::timeout(Duration::from_secs(30), run).await {
        Ok(Ok(output)) => {
            output.status.success() && String::from_utf8_lossy(&output.stdout).contains(SHELL_MARK)
        }
        _ => false,
    }
}

/// Removes spec files left by an earlier run. Each holds a command line and its environment, so none should outlive it.
pub fn sweep_specs(data_dir: &Path) -> usize {
    let specs = data_dir.join("sandbox").join("specs");
    let entries = match fs::read_dir(&specs) {
        Ok(entries) => entries,
        Err(error) => {
            if error.kind() != std::io::ErrorKind::NotFound {
                log_warn("spec sweep failed", json!({ "code": error.raw_os_error() }));
            }
            return 0;
        }
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "json") {
            match fs::remove_file(&path) {
                Ok(()) => removed += 1,
                Err(error) => log_warn("spec not removed", json!({ "code": error.raw_os_error() })),
            }
        }
    }
    if removed > 0 {
        log_info("old specs removed", json!({ "removed": removed }));
    }
    removed
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
                cid: "c".into(),
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
    fn stderr_splits_admin_folders_from_warnings() {
        let text = "sandbox: needs-admin-read: C:\\Node\nsandbox: needs-admin: C:\\Users\nwarn one\nsandbox: needs-admin: C:\\\n";
        let (folders, rest) = split_stderr(text);
        assert_eq!(folders, ["C:\\Users", "C:\\", "--read", "C:\\Node"]);
        assert_eq!(rest, vec!["warn one".to_owned()]);
    }

    #[test]
    fn sweep_removes_only_spec_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        let specs = dir.path().join("sandbox").join("specs");
        fs::create_dir_all(&specs).expect("specs");
        fs::write(specs.join("old.json"), b"{}").expect("spec");
        fs::write(specs.join("keep.txt"), b"x").expect("other");
        assert_eq!(sweep_specs(dir.path()), 1);
        assert!(specs.join("keep.txt").exists());
        assert!(!specs.join("old.json").exists());
    }

    #[tokio::test]
    async fn each_shell_is_checked_once_per_identity() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        DONE.lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert("shell-test-key".into());
        let launch = Launch {
            file: PathBuf::from("draggy-sandbox.exe"),
            args: Vec::new(),
            verbatim: false,
            cwd: std::env::temp_dir(),
            env: BTreeMap::new(),
            grant: Some(Grant {
                key: "shell-test-key".into(),
                spec: json!({ "identity": "shell-test-identity" }),
                specs: std::env::temp_dir(),
                cid: "c".into(),
            }),
        };
        let calls = Arc::new(AtomicUsize::new(0));
        for _ in 0..2 {
            let counted = Arc::clone(&calls);
            let works = shell_works_with(&launch, "shell-test-a", move |_: Launch| async move {
                counted.fetch_add(1, Ordering::SeqCst);
                true
            })
            .await;
            assert!(works);
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(proven_shells().contains(&"shell-test-a".to_owned()));
    }

    #[test]
    fn ca_bundles_are_copied_or_dropped() {
        let dir = std::env::temp_dir().join(format!("draggy-ca-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let source = dir.join("source.pem");
        std::fs::write(&source, "cert").unwrap();
        let mut env = BTreeMap::from([
            (
                "NODE_EXTRA_CA_CERTS".to_owned(),
                source.display().to_string(),
            ),
            (
                "SSL_CERT_FILE".to_owned(),
                dir.join("missing.pem").display().to_string(),
            ),
        ]);
        copy_ca_bundles(&mut env, &dir.join("certs"));
        let copy = env.get("NODE_EXTRA_CA_CERTS").unwrap();
        assert!(copy.starts_with(&dir.join("certs").display().to_string()));
        assert_eq!(std::fs::read_to_string(copy).unwrap(), "cert");
        assert!(!env.contains_key("SSL_CERT_FILE"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    #[ignore = "needs draggy-sandbox.exe next to the app"]
    fn launcher_is_found_when_bundled() {
        assert!(launcher(None).is_some());
    }
}
