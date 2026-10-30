//! The MLX engine on Apple silicon: the server command, the hash-pinned requirements check, the health route and how
//! failures are named. The process itself is started by the macOS shell; nothing here runs on other systems.

use std::path::{Path, PathBuf};

use crate::platform::{Arch, Os};

/// True where MLX can run.
pub fn supported(os: Os, arch: Arch) -> bool {
    os == Os::MacOs && arch == Arch::Arm64
}

/// The command line for `mlx_lm.server`. Loopback only.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MlxLaunch {
    pub program: PathBuf,
    pub args: Vec<String>,
}

pub fn build_launch(python: &Path, model_dir: &Path, port: u16) -> MlxLaunch {
    MlxLaunch {
        program: python.to_owned(),
        args: vec![
            "-m".into(),
            "mlx_lm.server".into(),
            "--model".into(),
            model_dir.display().to_string(),
            "--host".into(),
            "127.0.0.1".into(),
            "--port".into(),
            port.to_string(),
        ],
    }
}

pub fn health_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/v1/models")
}

/// One requirement from a hash-pinned requirements file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Requirement {
    pub name: String,
    pub version: String,
    pub hashes: Vec<String>,
}

/// Parses `name==version \` followed by `--hash=sha256:<hex>` lines. A package without a version pin or without a hash
/// is an error, so an unpinned install cannot slip through.
pub fn parse_requirements(text: &str) -> Result<Vec<Requirement>, String> {
    let joined = text.replace("\\\r\n", " ").replace("\\\n", " ");
    let mut out = Vec::new();
    for line in joined.lines() {
        let line = line.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split_whitespace();
        let spec = parts.next().unwrap_or_default();
        let Some((name, version)) = spec.split_once("==") else {
            return Err(format!("{spec}: not pinned with =="));
        };
        let hashes: Vec<String> = parts
            .filter_map(|p| p.strip_prefix("--hash=sha256:"))
            .map(str::to_owned)
            .collect();
        if hashes.is_empty()
            || hashes
                .iter()
                .any(|h| h.len() != 64 || !h.bytes().all(|b| b.is_ascii_hexdigit()))
        {
            return Err(format!("{name}: missing or malformed sha256 hash"));
        }
        out.push(Requirement {
            name: name.to_owned(),
            version: version.to_owned(),
            hashes,
        });
    }
    if out.is_empty() {
        return Err("no requirements".to_owned());
    }
    Ok(out)
}

/// The hash-pinned requirements the MLX environment is built from (macOS arm64, Python 3.12). mlx-lm is MIT licensed.
pub const REQUIREMENTS: &str = include_str!("../data/mlx-requirements.txt");

/// Why an MLX start failed, as a stable key the shells can translate.
pub fn failure_key(output: &str) -> &'static str {
    let lower = output.to_ascii_lowercase();
    if lower.contains("out of memory")
        || lower.contains("insufficient memory")
        || lower.contains("kiogpucommandbuffercallbackerrorouto")
    {
        "mlx-nomem"
    } else if lower.contains("no module named") || lower.contains("modulenotfounderror") {
        "mlx-runtime-missing"
    } else if lower.contains("address already in use") {
        "mlx-port-busy"
    } else if lower.contains("unsupported model")
        || lower.contains("model type") && lower.contains("not supported")
    {
        "mlx-unsupported-model"
    } else {
        "mlx-start-failed"
    }
}

/// Removes anything that looks like a token or a home path from a log line before it is stored.
pub fn redact(line: &str) -> String {
    line.split_whitespace()
        .map(|word| {
            if word.starts_with("hf_") || word.starts_with("sk-") {
                "[redacted]".to_owned()
            } else if let Some(at) = word.find("/Users/") {
                format!("{}~", &word[..at])
            } else {
                word.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// The supervisor plan for one MLX start: the server on loopback, ready when `/v1/models` answers.
pub fn spawn_plan(python: &Path, model_dir: &Path, port: u16) -> crate::supervisor::SpawnPlan {
    let launch = build_launch(python, model_dir, port);
    crate::supervisor::SpawnPlan {
        program: launch.program,
        args: launch.args,
        cwd: None,
        env: vec![
            ("PYTHONUNBUFFERED".into(), "1".into()),
            ("PYTHONUTF8".into(), "1".into()),
        ],
        port,
        ready_path: "/v1/models",
        model: model_dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        timeout: std::time::Duration::from_secs(300),
    }
}

/// Starts MLX on a free port as the one running engine. A failed start maps to a failure key and is never retried on
/// llama.cpp, which cannot read MLX weights.
pub async fn start(
    supervisor: &crate::supervisor::Supervisor,
    os: Os,
    arch: Arch,
    python: &Path,
    model_dir: &Path,
    port: u16,
) -> Result<(), String> {
    if !supported(os, arch) {
        return Err("The MLX engine runs only on Apple silicon Macs.".to_owned());
    }
    match supervisor.start(spawn_plan(python, model_dir, port)).await {
        crate::supervisor::StartResult::Ready => Ok(()),
        crate::supervisor::StartResult::Failed { output } => Err(failure_key(&output).to_owned()),
    }
}

/// A port nothing listens on, asked from the system.
pub fn free_port() -> Option<u16> {
    std::net::TcpListener::bind(("127.0.0.1", 0))
        .ok()?
        .local_addr()
        .ok()
        .map(|a| a.port())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_apple_silicon_supports_mlx() {
        assert!(supported(Os::MacOs, Arch::Arm64));
        assert!(!supported(Os::MacOs, Arch::X64));
        assert!(!supported(Os::Linux, Arch::Arm64));
        assert!(!supported(Os::Windows, Arch::X64));
    }

    #[test]
    fn launch_binds_loopback() {
        let l = build_launch(Path::new("/v/bin/python"), Path::new("/m"), 8123);
        assert_eq!(&l.args[..2], ["-m", "mlx_lm.server"]);
        assert!(l.args.windows(2).any(|w| w == ["--host", "127.0.0.1"]));
        assert_eq!(health_url(8123), "http://127.0.0.1:8123/v1/models");
    }

    #[test]
    fn requirements_must_be_pinned_and_hashed() {
        let hash = "a".repeat(64);
        let ok = format!(
            "mlx-lm==0.1.0 \\\n    --hash=sha256:{hash}\n# c\nmlx==0.2 --hash=sha256:{hash}\n"
        );
        let parsed = parse_requirements(&ok).unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].version, "0.1.0");
        assert!(parse_requirements("mlx>=1 --hash=sha256:x").is_err());
        assert!(parse_requirements("mlx==1").is_err());
        assert!(parse_requirements("# only a comment").is_err());
    }

    #[test]
    fn failures_map_to_keys() {
        assert_eq!(
            failure_key("ModuleNotFoundError: No module named 'mlx'"),
            "mlx-runtime-missing"
        );
        assert_eq!(
            failure_key("OSError: [Errno 48] Address already in use"),
            "mlx-port-busy"
        );
        assert_eq!(failure_key("RuntimeError: out of memory"), "mlx-nomem");
        assert_eq!(failure_key("boom"), "mlx-start-failed");
    }

    #[test]
    fn a_free_port_is_found_and_the_plan_is_loopback() {
        assert!(free_port().is_some());
        let plan = spawn_plan(Path::new("/py"), Path::new("/models/q"), 9000);
        assert_eq!(plan.ready_path, "/v1/models");
        assert_eq!(plan.model, "q");
    }

    #[tokio::test]
    async fn mlx_refuses_off_apple_silicon() {
        let sup = crate::supervisor::Supervisor::new();
        let r = start(
            &sup,
            Os::Linux,
            Arch::X64,
            Path::new("/py"),
            Path::new("/m"),
            9,
        )
        .await;
        assert!(r.is_err());
    }

    #[test]
    fn the_bundled_requirements_are_all_pinned_and_hashed() {
        let parsed = parse_requirements(REQUIREMENTS).unwrap();
        assert!(parsed.iter().any(|r| r.name == "mlx-lm"));
        assert!(parsed.iter().any(|r| r.name == "mlx"));
    }

    #[test]
    fn logs_are_redacted() {
        assert_eq!(
            redact("token hf_abc123 at /Users/me/x"),
            "token [redacted] at ~"
        );
    }
}
