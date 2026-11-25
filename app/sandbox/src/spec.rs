//! The launch spec Node writes. Same shape as `SandboxSpec` in core/crates/tools/src/sandbox.rs, plus the Windows
//! identity name and the full command line, which must reach the program unchanged.

use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Spec {
    /// Container name; one per project and access level.
    pub identity: String,
    pub cwd: String,
    #[serde(default)]
    pub read_only: Vec<String>,
    #[serde(default)]
    pub read_write: Vec<String>,
    #[serde(default)]
    pub network: bool,
    #[serde(default)]
    pub env: Vec<(String, String)>,
    /// The Windows command line, program first.
    pub command_line: String,
}

pub fn load(path: &str) -> Result<Spec, String> {
    let text =
        std::fs::read_to_string(path).map_err(|error| format!("cannot read the spec: {error}"))?;
    let spec: Spec = serde_json::from_str(&text).map_err(|error| format!("bad spec: {error}"))?;
    if spec.command_line.trim().is_empty() {
        return Err("the spec has no command".into());
    }
    let name_ok = !spec.identity.is_empty()
        && spec.identity.len() <= 48
        && spec
            .identity
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    if !name_ok {
        return Err("bad identity name".into());
    }
    Ok(spec)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(text: &str) -> Result<Spec, String> {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let file = std::env::temp_dir().join(format!("dg-spec-{}-{n}.json", std::process::id()));
        std::fs::write(&file, text).unwrap();
        load(file.to_str().unwrap())
    }

    #[test]
    fn a_spec_without_a_command_is_refused() {
        assert!(parse(r#"{"identity":"a","cwd":"C:/x","commandLine":" "}"#).is_err());
    }

    #[test]
    fn an_identity_with_odd_characters_is_refused() {
        assert!(parse(r#"{"identity":"a b","cwd":"C:/x","commandLine":"node"}"#).is_err());
    }

    #[test]
    fn a_minimal_spec_loads_with_the_network_off() {
        let spec = parse(r#"{"identity":"p1-ro","cwd":"C:/x","commandLine":"node -v"}"#).unwrap();
        assert!(!spec.network && spec.read_write.is_empty());
    }
}
