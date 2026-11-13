//! What a sandboxed command may see and do, and how each launcher is told. The Windows launcher reads the same spec
//! as JSON. The scrub rules are pinned by shared/fixtures/sandbox/env.json.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Names that are secrets whatever their prefix: matched per `_` segment, case-insensitively.
const SECRET_SEGMENTS: [&str; 8] = [
    "KEY",
    "TOKEN",
    "SECRET",
    "PASSWORD",
    "PASSWD",
    "CREDENTIAL",
    "CREDENTIALS",
    "AUTH",
];
const SECRET_PREFIXES: [&str; 4] = ["AWS_", "AZURE_", "GCP_", "DRAGGY_"];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxSpec {
    pub project: PathBuf,
    pub cwd: PathBuf,
    /// Folders the command may read, such as toolchains.
    pub read_only: Vec<PathBuf>,
    /// Folders the command may write: the project, plus its own temp and cache.
    pub read_write: Vec<PathBuf>,
    pub network: bool,
    pub env: Vec<(String, String)>,
    pub command: Vec<String>,
}

/// The folders and network access a boxed command gets; the shell, cwd and environment come from the request.
#[derive(Clone, Debug, Default)]
pub struct Boxed {
    pub project: PathBuf,
    pub read_only: Vec<PathBuf>,
    pub read_write: Vec<PathBuf>,
    pub network: bool,
}

/// The program and arguments that run `command` inside the host sandbox: bubblewrap on Linux, sandbox-exec on macOS.
/// None on any other host, where the caller refuses to run rather than run unboxed.
pub fn host_wrap(
    boxed: &Boxed,
    cwd: &std::path::Path,
    env: Vec<(String, String)>,
    command: Vec<String>,
) -> Option<(String, Vec<String>)> {
    let spec = SandboxSpec {
        project: boxed.project.clone(),
        cwd: cwd.to_path_buf(),
        read_only: boxed.read_only.clone(),
        read_write: boxed.read_write.clone(),
        network: boxed.network,
        env: scrub_env(env),
        command,
    };
    tracing::debug!(
        target: "tools.sandbox",
        platform = std::env::consts::OS,
        network = spec.network,
        read_only = spec.read_only.len(),
        read_write = spec.read_write.len(),
        "sandbox policy applied"
    );
    if cfg!(target_os = "linux") {
        Some(("bwrap".into(), bubblewrap_args(&spec)))
    } else if cfg!(target_os = "macos") {
        let mut args = vec!["-p".to_string(), seatbelt_profile(&spec), "--".to_string()];
        args.extend(spec.command);
        Some(("/usr/bin/sandbox-exec".into(), args))
    } else {
        tracing::warn!(target: "tools.sandbox", platform = std::env::consts::OS, "sandbox unavailable on this platform");
        None
    }
}

/// True when the variable name looks like a key, token or credential, so it never reaches a sandboxed command.
pub fn is_secret_name(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    if SECRET_PREFIXES
        .iter()
        .any(|prefix| upper.starts_with(prefix))
    {
        return true;
    }
    upper.split('_').any(|part| SECRET_SEGMENTS.contains(&part)) || upper.ends_with("APIKEY")
}

pub fn scrub_env<I: IntoIterator<Item = (String, String)>>(env: I) -> Vec<(String, String)> {
    env.into_iter()
        .filter(|(name, _)| !is_secret_name(name))
        .collect()
}

/// `--unshare-all` drops the network; `--share-net` gives it back. Anything not bound is not there.
pub fn bubblewrap_args(spec: &SandboxSpec) -> Vec<String> {
    let mut args: Vec<String> = ["--unshare-all", "--die-with-parent", "--new-session"]
        .map(String::from)
        .to_vec();
    if spec.network {
        args.push("--share-net".into());
    }
    for system in ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc"] {
        args.extend(["--ro-bind-try".into(), system.into(), system.into()]);
    }
    args.extend([
        "--proc".into(),
        "/proc".into(),
        "--dev".into(),
        "/dev".into(),
        "--tmpfs".into(),
        "/tmp".into(),
    ]);
    for folder in &spec.read_only {
        let text = display(folder);
        args.extend(["--ro-bind-try".into(), text.clone(), text]);
    }
    for folder in &spec.read_write {
        let text = display(folder);
        args.extend(["--bind".into(), text.clone(), text]);
    }
    args.extend(["--chdir".into(), display(&spec.cwd), "--clearenv".into()]);
    for (name, value) in &spec.env {
        args.extend(["--setenv".into(), name.clone(), value.clone()]);
    }
    args.push("--".into());
    args.extend(spec.command.iter().cloned());
    args
}

/// A `sandbox-exec` profile that denies everything, then allows reading the system, the listed folders and writing
/// only the read-write ones.
pub fn seatbelt_profile(spec: &SandboxSpec) -> String {
    let mut out =
        String::from("(version 1)\n(deny default)\n(allow process-fork)\n(allow process-exec)\n");
    out.push_str(
        "(allow sysctl-read)\n(allow mach-lookup)\n(allow signal (target self))\n(allow file-read-metadata)\n",
    );
    for system in [
        "/usr",
        "/bin",
        "/sbin",
        "/System",
        "/Library",
        "/private/etc",
        "/dev",
        "/private/var/db",
    ] {
        out.push_str(&format!("(allow file-read* (subpath \"{system}\"))\n"));
    }
    for folder in &spec.read_only {
        out.push_str(&format!(
            "(allow file-read* (subpath \"{}\"))\n",
            quote(folder)
        ));
    }
    for folder in &spec.read_write {
        let path = quote(folder);
        out.push_str(&format!(
            "(allow file-read* file-write* (subpath \"{path}\"))\n"
        ));
    }
    out.push_str("(allow file-write* (literal \"/dev/null\"))\n");
    if spec.network {
        out.push_str("(allow network*)\n");
    }
    out
}

fn display(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn quote(path: &Path) -> String {
    display(path).replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(network: bool) -> SandboxSpec {
        SandboxSpec {
            project: "/work/app".into(),
            cwd: "/work/app".into(),
            read_only: vec!["/opt/node".into()],
            read_write: vec!["/work/app".into()],
            network,
            env: vec![("PATH".into(), "/usr/bin".into())],
            command: vec!["npm".into(), "test".into()],
        }
    }

    #[test]
    fn bubblewrap_drops_the_network_unless_allowed() {
        assert!(!bubblewrap_args(&spec(false)).contains(&"--share-net".to_string()));
        assert!(bubblewrap_args(&spec(true)).contains(&"--share-net".to_string()));
    }

    #[test]
    fn bubblewrap_binds_the_project_writable_and_toolchains_read_only() {
        let args = bubblewrap_args(&spec(false)).join(" ");
        assert!(args.contains("--bind /work/app /work/app"));
        assert!(args.contains("--ro-bind-try /opt/node /opt/node"));
        assert!(args.ends_with("-- npm test"));
    }

    #[test]
    fn seatbelt_denies_by_default_and_writes_only_where_allowed() {
        let profile = seatbelt_profile(&spec(false));
        assert!(profile.contains("(deny default)"));
        assert!(profile.contains("(allow file-read* file-write* (subpath \"/work/app\"))"));
        assert!(!profile.contains("file-write* (subpath \"/opt/node\")"));
        assert!(!profile.contains("network"));
        assert!(seatbelt_profile(&spec(true)).contains("(allow network*)"));
    }

    /// The golden policy both launchers must generate: shared/fixtures/sandbox/policy.json, also read by Swift tests.
    fn golden_cases() -> Vec<(SandboxSpec, Vec<String>, Vec<String>)> {
        let raw = include_str!("../../../../shared/fixtures/sandbox/policy.json");
        let doc: serde_json::Value = serde_json::from_str(raw).expect("policy.json parses");
        doc["cases"]
            .as_array()
            .expect("cases")
            .iter()
            .map(|case| {
                let s = &case["spec"];
                let strings = |v: &serde_json::Value| -> Vec<String> {
                    v.as_array()
                        .expect("array")
                        .iter()
                        .map(|x| x.as_str().expect("string").to_string())
                        .collect()
                };
                let paths = |v: &serde_json::Value| -> Vec<PathBuf> {
                    strings(v).into_iter().map(PathBuf::from).collect()
                };
                let env = s["env"]
                    .as_array()
                    .expect("env")
                    .iter()
                    .map(|pair| {
                        let p = strings(pair);
                        (p[0].clone(), p[1].clone())
                    })
                    .collect();
                let spec = SandboxSpec {
                    project: PathBuf::from(s["project"].as_str().expect("project")),
                    cwd: PathBuf::from(s["cwd"].as_str().expect("cwd")),
                    read_only: paths(&s["readOnly"]),
                    read_write: paths(&s["readWrite"]),
                    network: s["network"].as_bool().expect("network"),
                    env,
                    command: strings(&s["command"]),
                };
                (
                    spec,
                    strings(&case["bubblewrap"]),
                    strings(&case["seatbelt"]),
                )
            })
            .collect()
    }

    #[test]
    fn golden_bubblewrap_args_match_the_fixture() {
        for (spec, bwrap, _) in golden_cases() {
            assert_eq!(bubblewrap_args(&spec), bwrap);
        }
    }

    #[test]
    fn golden_seatbelt_profile_matches_the_fixture() {
        for (spec, _, seatbelt) in golden_cases() {
            let profile = seatbelt_profile(&spec);
            let lines: Vec<&str> = profile.lines().collect();
            let expected: Vec<&str> = seatbelt.iter().map(String::as_str).collect();
            assert_eq!(lines, expected);
        }
    }

    #[test]
    fn scrubbed_env_never_reaches_the_wrapped_command() {
        let env = scrub_env(vec![
            ("PATH".to_string(), "/usr/bin".to_string()),
            ("GITHUB_TOKEN".to_string(), "x".to_string()),
        ]);
        assert_eq!(env, vec![("PATH".to_string(), "/usr/bin".to_string())]);
    }

    #[test]
    fn secret_names_are_found_by_segment() {
        for name in [
            "ANTHROPIC_API_KEY",
            "GITHUB_TOKEN",
            "aws_region",
            "NPM_CONFIG_AUTH",
            "OPENAI_APIKEY",
            "DRAGGY_HOME",
        ] {
            assert!(is_secret_name(name), "{name}");
        }
        for name in [
            "PATH",
            "KEYBOARD",
            "MONKEY_PATCH",
            "TEMP",
            "HOMEPATH",
            "AUTHOR_NAME",
        ] {
            assert!(!is_secret_name(name), "{name}");
        }
    }
}
