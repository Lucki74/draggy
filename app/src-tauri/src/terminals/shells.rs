//! Which shells a terminal can open and how each one starts. On Windows, Git for Windows supplies bash and sh and
//! the WSL bash in System32 is refused because it cannot see the project folder. On macOS and Linux they come from PATH.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const SHELL_IDS: [&str; 6] = ["pwsh", "powershell", "cmd", "bash", "sh", "zsh"];
const GIT_FOLDERS: [&str; 2] = ["cmd", "bin"];

/// Where programs are looked up: PATH, PATHEXT and the standard Git for Windows roots.
#[derive(Debug, Clone, Default)]
pub struct Env {
    pub path: String,
    pub pathext: String,
    pub git_roots: Vec<PathBuf>,
    /// The user's login shell from `$SHELL`, which macOS and Linux terminals open by default.
    pub login_shell: Option<String>,
}

impl Env {
    pub fn system() -> Self {
        let var = |name: &str| std::env::var(name).ok();
        let git_roots = [
            var("ProgramFiles"),
            var("ProgramFiles(x86)"),
            var("LOCALAPPDATA").map(|dir| format!("{dir}\\Programs")),
        ]
        .into_iter()
        .flatten()
        .map(|root| PathBuf::from(root).join("Git"))
        .collect();
        Self {
            path: var("PATH").or_else(|| var("Path")).unwrap_or_default(),
            pathext: var("PATHEXT")
                .unwrap_or_else(|| if cfg!(windows) { ".EXE;.CMD;.BAT" } else { "" }.to_string()),
            git_roots,
            login_shell: if cfg!(windows) {
                None
            } else {
                var("SHELL").and_then(|shell| login_shell_id(&shell))
            },
        }
    }
}

/// The shell id for a `$SHELL` path such as `/bin/zsh`, when it is one Draggy knows.
fn login_shell_id(path: &str) -> Option<String> {
    let name = path.rsplit('/').next()?;
    SHELL_IDS.contains(&name).then(|| name.to_owned())
}

fn path_dirs(path: &str) -> Vec<PathBuf> {
    std::env::split_paths(path)
        .filter(|dir| !dir.as_os_str().is_empty())
        .collect()
}

/// An executable on PATH. The extensions come from PATHEXT unless the name already has one; an empty PATHEXT
/// (macOS and Linux) looks for the bare name.
pub fn find_on_path(env: &Env, name: &str) -> Option<PathBuf> {
    let extensions: Vec<String> = if Path::new(name).extension().is_some() || env.pathext.is_empty()
    {
        vec![String::new()]
    } else {
        env.pathext
            .split(';')
            .filter(|ext| !ext.is_empty())
            .map(str::to_ascii_lowercase)
            .collect()
    };
    path_dirs(&env.path)
        .into_iter()
        .flat_map(|dir| {
            extensions
                .iter()
                .map(move |ext| dir.join(format!("{name}{ext}")))
        })
        .find(|candidate| candidate.is_file())
}

/// The Git for Windows folder that holds git.exe: a standard install first, then the one PATH points at.
pub fn git_root(env: &Env) -> Option<PathBuf> {
    let installed = env.git_roots.iter().find(|root| {
        GIT_FOLDERS
            .iter()
            .any(|folder| root.join(folder).join("git.exe").is_file())
    });
    if let Some(root) = installed {
        return Some(root.clone());
    }
    for dir in path_dirs(&env.path) {
        if !dir.join("git.exe").is_file() {
            continue;
        }
        let folder = dir
            .file_name()
            .map(|name| name.to_string_lossy().to_ascii_lowercase());
        let root = dir.parent().map(Path::to_path_buf);
        let in_git = root
            .as_ref()
            .and_then(|r| r.file_name())
            .is_some_and(|name| name.eq_ignore_ascii_case("git"));
        if in_git && folder.is_some_and(|f| GIT_FOLDERS.contains(&f.as_str())) {
            return root;
        }
    }
    None
}

/// bash or sh from Git for Windows. A PATH hit in System32 is WSL's bash, which cannot reach the project.
pub fn find_posix_shell(env: &Env, name: &str) -> Option<PathBuf> {
    let roots: Vec<PathBuf> = git_root(env)
        .into_iter()
        .chain(env.git_roots.iter().cloned())
        .collect();
    for root in roots {
        for candidate in [
            root.join("bin").join(format!("{name}.exe")),
            root.join("usr").join("bin").join(format!("{name}.exe")),
        ] {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    find_on_path(env, name).filter(|found| {
        !found
            .components()
            .any(|part| part.as_os_str().eq_ignore_ascii_case("system32"))
    })
}

pub fn find(env: &Env, name: &str) -> Option<PathBuf> {
    match name {
        "bash" | "sh" => find_posix_shell(env, name),
        "cmd" if !cfg!(windows) => None,
        _ => find_on_path(env, name),
    }
}

/// The shells a terminal can open. Windows: PowerShell (pwsh when installed), cmd, then the Git shells.
/// macOS and Linux: zsh, bash and sh when installed, then pwsh.
pub fn available(env: &Env) -> Vec<String> {
    if !cfg!(windows) {
        return ["zsh", "bash", "sh", "pwsh"]
            .into_iter()
            .filter(|name| find(env, name).is_some())
            .map(str::to_string)
            .collect();
    }
    let powershell = if find(env, "pwsh").is_some() {
        "pwsh"
    } else {
        "powershell"
    };
    let mut found = vec![powershell.to_string(), "cmd".to_string()];
    for name in ["bash", "sh"] {
        if find(env, name).is_some() {
            found.push(name.to_string());
        }
    }
    found
}

/// Arguments that start an interactive session in each shell.
pub fn interactive_args(shell: &str) -> Vec<String> {
    match shell {
        "bash" => vec!["--login".into(), "-i".into()],
        "zsh" => vec!["-l".into(), "-i".into()],
        "sh" => vec!["-i".into()],
        "pwsh" | "powershell" => vec!["-NoLogo".into()],
        _ => Vec::new(),
    }
}

/// A command ready to start. `verbatim` arguments reach the program as written, unquoted (cmd only).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Invocation {
    pub shell: String,
    pub file: PathBuf,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub verbatim: bool,
    pub notice: Option<String>,
}

/// What runs `command`: the shell asked for, else the Default shell setting, else bash, pwsh, Windows
/// PowerShell. Inside the sandbox a shell runs only if `sandbox_shells` lists it (a check showed it starts there),
/// else the command is swapped for cmd with a notice.
pub fn invocation(
    env: &Env,
    command: &str,
    requested: Option<&str>,
    default_shell: Option<&str>,
    sandboxed: bool,
    sandbox_shells: &[String],
) -> Result<Invocation, String> {
    let mut shell = requested
        .filter(|name| SHELL_IDS.contains(name))
        .unwrap_or("default");
    let mut notice = None;
    if shell == "default" {
        // With no default set, the login shell comes first, as a terminal app opens it.
        let preferred = default_shell
            .filter(|name| SHELL_IDS.contains(name))
            .or_else(|| {
                env.login_shell
                    .as_deref()
                    .filter(|name| find(env, name).is_some())
            });
        let has_bash = find(env, "bash").is_some();
        match preferred {
            Some(name) if (name == "cmd" && cfg!(windows)) || find(env, name).is_some() => {
                shell = name
            }
            _ => {
                if let Some(name) = preferred {
                    let fallback = if has_bash {
                        "bash"
                    } else if cfg!(windows) {
                        "PowerShell"
                    } else {
                        "sh"
                    };
                    notice = Some(format!(
                        "{name} is not installed, so commands run in {fallback} instead. Change the default shell in Settings."
                    ));
                }
                shell = if has_bash {
                    "bash"
                } else if !cfg!(windows) {
                    "sh"
                } else if find(env, "pwsh").is_some() {
                    "pwsh"
                } else {
                    "powershell"
                };
            }
        }
    }
    // Git's ls, grep and the rest are on PATH too and fail the same way, so the model is steered to cmd's own commands.
    // Only Windows has the sandbox launcher; elsewhere sandbox::wrap refuses the command whatever the shell.
    if cfg!(windows)
        && sandboxed
        && shell != "cmd"
        && !sandbox_shells.iter().any(|name| name == shell)
    {
        let posix = if shell == "bash" || shell == "sh" {
            " Git's Unix tools such as ls and grep do not start there either, so use cmd commands such as dir and findstr."
        } else {
            ""
        };
        notice = Some(format!(
            "{shell} does not start inside the sandbox, so the command ran in cmd.{posix}"
        ));
        shell = "cmd";
    }
    let base = Invocation {
        shell: shell.to_string(),
        file: PathBuf::new(),
        args: Vec::new(),
        env: Vec::new(),
        verbatim: false,
        notice,
    };
    let installed =
        || find(env, shell).ok_or_else(|| format!("{shell} is not installed on this computer."));
    Ok(match shell {
        "pwsh" | "powershell" => {
            // UTF-8 output and the native exit code passed on. The policy goes in the environment so npm's .ps1 shims run
            // without a Bypass switch on the command line, which antivirus heuristics flag.
            let script = format!(
                "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; {command}\nif ($?) {{ exit 0 }} elseif ($LASTEXITCODE) {{ exit $LASTEXITCODE }} else {{ exit 1 }}"
            );
            let args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"];
            let mut args: Vec<String> = args.iter().map(|arg| (*arg).to_string()).collect();
            args.push(script);
            Invocation {
                file: installed()?,
                args,
                env: vec![("PSExecutionPolicyPreference".into(), "Bypass".into())],
                ..base
            }
        }
        "cmd" if !cfg!(windows) => return Err("cmd is only available on Windows.".into()),
        // cmd writes in the OEM code page, which reads as mangled UTF-8, so the console switches to UTF-8 first.
        "cmd" => Invocation {
            file: comspec(),
            args: vec![
                "/d".into(),
                "/s".into(),
                "/c".into(),
                format!("\"chcp 65001>nul & {command}\""),
            ],
            verbatim: true,
            ..base
        },
        _ => {
            let mut args: Vec<String> = match shell {
                "bash" => vec!["--noprofile".into(), "--norc".into()],
                "zsh" => vec!["-f".into()],
                _ => Vec::new(),
            };
            args.extend(["-c".to_string(), command.to_string()]);
            Invocation {
                file: installed()?,
                args,
                env: vec![("MSYS_NO_PATHCONV".into(), "1".into())],
                ..base
            }
        }
    })
}

fn comspec() -> PathBuf {
    std::env::var_os("ComSpec")
        .or_else(|| std::env::var_os("COMSPEC"))
        .map_or_else(|| PathBuf::from("cmd.exe"), PathBuf::from)
}

/// The environment a command starts with: this process's, set so nothing stops to prompt, then `extra`.
pub fn build_env(extra: &[(String, String)]) -> BTreeMap<String, String> {
    let mut env: BTreeMap<String, String> = std::env::vars().collect();
    let quiet = [
        ("GIT_TERMINAL_PROMPT", "0"),
        ("GH_PROMPT_DISABLED", "1"),
        ("GIT_PAGER", "cat"),
        ("PAGER", "cat"),
        ("NO_COLOR", "1"),
        ("TERM", "dumb"),
    ];
    for (name, value) in quiet {
        env.insert(name.to_string(), value.to_string());
    }
    for (name, value) in extra {
        env.insert(name.clone(), value.clone());
    }
    env.remove("ELECTRON_RUN_AS_NODE");
    env
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_git(root: &Path) -> PathBuf {
        let git = root.join("Git");
        std::fs::create_dir_all(git.join("cmd")).expect("cmd dir");
        std::fs::create_dir_all(git.join("bin")).expect("bin dir");
        std::fs::write(git.join("cmd").join("git.exe"), b"").expect("git");
        std::fs::write(git.join("bin").join("bash.exe"), b"").expect("bash");
        git
    }

    fn env_with(path: &[PathBuf], git_roots: Vec<PathBuf>) -> Env {
        let joined = std::env::join_paths(path)
            .expect("join")
            .to_string_lossy()
            .into_owned();
        Env {
            path: joined,
            pathext: ".EXE;.CMD".into(),
            git_roots,
            login_shell: None,
        }
    }

    #[test]
    fn a_standard_git_install_supplies_bash_before_anything_on_path() {
        let dir = tempfile::tempdir().expect("tempdir");
        let git = fake_git(dir.path());
        let env = env_with(&[], vec![git.clone()]);
        assert_eq!(
            find_posix_shell(&env, "bash"),
            Some(git.join("bin").join("bash.exe"))
        );
    }

    #[test]
    fn git_root_comes_from_git_exe_on_path() {
        let dir = tempfile::tempdir().expect("tempdir");
        let git = fake_git(dir.path());
        let env = env_with(&[git.join("cmd")], vec![]);
        assert_eq!(git_root(&env), Some(git));
    }

    #[test]
    fn a_git_exe_outside_a_git_folder_is_ignored() {
        let dir = tempfile::tempdir().expect("tempdir");
        let tools = dir.path().join("tools");
        std::fs::create_dir_all(&tools).expect("tools");
        std::fs::write(tools.join("git.exe"), b"").expect("git");
        assert_eq!(git_root(&env_with(&[tools], vec![])), None);
    }

    #[test]
    fn wsl_bash_in_system32_is_refused() {
        let dir = tempfile::tempdir().expect("tempdir");
        let system32 = dir.path().join("System32");
        std::fs::create_dir_all(&system32).expect("system32");
        std::fs::write(system32.join("bash.exe"), b"").expect("bash");
        assert_eq!(
            find_posix_shell(&env_with(&[system32], vec![]), "bash"),
            None
        );
    }

    #[test]
    #[cfg(windows)]
    fn the_default_setting_wins_then_bash_with_a_notice_when_it_is_missing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let env = env_with(&[], vec![fake_git(dir.path())]);
        let picked = invocation(&env, "ls", None, Some("cmd"), false, &[]).expect("cmd");
        assert_eq!(picked.shell, "cmd");
        assert!(picked.notice.is_none());
        let fallback = invocation(&env, "ls", None, Some("pwsh"), false, &[]).expect("bash");
        assert_eq!(fallback.shell, "bash");
        assert_eq!(fallback.args, vec!["--noprofile", "--norc", "-c", "ls"]);
        assert_eq!(
            fallback.env,
            vec![("MSYS_NO_PATHCONV".to_string(), "1".to_string())]
        );
        assert_eq!(
            fallback.notice.as_deref(),
            Some(
                "pwsh is not installed, so commands run in bash instead. Change the default shell in Settings."
            )
        );
    }

    #[test]
    #[cfg(windows)]
    fn cmd_gets_the_command_verbatim_and_the_sandbox_forces_it() {
        let env = env_with(&[], vec![]);
        let cmd = invocation(&env, "dir /b", Some("cmd"), None, false, &[]).expect("cmd");
        assert_eq!(
            cmd.args,
            vec!["/d", "/s", "/c", "\"chcp 65001>nul & dir /b\""]
        );
        assert!(cmd.verbatim);
        let boxed = invocation(&env, "ls", Some("bash"), None, true, &[]).expect("boxed");
        assert_eq!(boxed.shell, "cmd");
        assert_eq!(
            boxed.notice.as_deref(),
            Some(
                "bash does not start inside the sandbox, so the command ran in cmd. Git's Unix tools such as ls and grep do not start there either, so use cmd commands such as dir and findstr."
            )
        );
    }

    #[test]
    fn a_proven_shell_runs_inside_the_sandbox() {
        let dir = tempfile::tempdir().expect("tempdir");
        let env = env_with(&[], vec![fake_git(dir.path())]);
        let proven = vec!["bash".to_string()];
        let kept = invocation(&env, "ls", Some("bash"), None, true, &proven).expect("proven");
        assert_eq!(kept.shell, "bash");
        assert!(kept.notice.is_none());
    }

    #[test]
    fn powershell_passes_the_exit_code_on() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("pwsh.exe"), b"").expect("pwsh");
        let env = env_with(&[dir.path().to_path_buf()], vec![]);
        let run = invocation(&env, "npm test", Some("pwsh"), None, false, &[]).expect("pwsh");
        assert_eq!(
            &run.args[..4],
            ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"]
        );
        assert!(!run.args.iter().any(|arg| arg.contains("Bypass")));
        assert_eq!(
            run.env,
            [(
                "PSExecutionPolicyPreference".to_string(),
                "Bypass".to_string()
            )]
        );
        assert!(run.args[4].contains("npm test\nif ($?) { exit 0 }"));
    }

    #[test]
    fn a_requested_shell_that_is_missing_is_an_error() {
        let dir = tempfile::tempdir().expect("tempdir");
        let env = env_with(&[dir.path().to_path_buf()], vec![]);
        let error = invocation(&env, "", Some("bash"), None, false, &[]).expect_err("missing bash");
        assert_eq!(error, "bash is not installed on this computer.");
    }

    #[test]
    fn the_environment_cannot_prompt_and_extra_wins() {
        let env = build_env(&[("TERM".into(), "xterm-256color".into())]);
        assert_eq!(
            env.get("GIT_TERMINAL_PROMPT").map(String::as_str),
            Some("0")
        );
        assert_eq!(env.get("TERM").map(String::as_str), Some("xterm-256color"));
    }

    #[test]
    fn an_empty_pathext_finds_the_bare_name() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("zsh"), b"").expect("zsh");
        let env = Env {
            pathext: String::new(),
            ..env_with(&[dir.path().to_path_buf()], vec![])
        };
        assert_eq!(find_on_path(&env, "zsh"), Some(dir.path().join("zsh")));
        let run = invocation(&env, "ls", Some("zsh"), None, false, &[]).expect("zsh");
        assert_eq!(run.args, vec!["-f", "-c", "ls"]);
    }

    #[test]
    #[cfg(not(windows))]
    fn unix_lists_only_installed_shells_and_has_no_cmd() {
        let dir = tempfile::tempdir().expect("tempdir");
        for name in ["zsh", "bash"] {
            std::fs::write(dir.path().join(name), b"").expect(name);
        }
        let env = Env {
            pathext: String::new(),
            ..env_with(&[dir.path().to_path_buf()], vec![])
        };
        assert_eq!(available(&env), vec!["zsh", "bash"]);
        let picked = invocation(&env, "ls", None, None, true, &[]).expect("bash");
        assert_eq!(picked.shell, "bash");
        assert!(invocation(&env, "dir", Some("cmd"), None, false, &[]).is_err());
    }

    #[test]
    fn interactive_args_match_each_shell() {
        assert_eq!(interactive_args("bash"), vec!["--login", "-i"]);
        assert_eq!(interactive_args("sh"), vec!["-i"]);
        assert_eq!(interactive_args("pwsh"), vec!["-NoLogo"]);
        assert!(interactive_args("cmd").is_empty());
    }
}
