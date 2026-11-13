//! Debug lines for child processes started outside the git runner. Only the program name, the flags and a count
//! of values are logged; values, and anything after a secret-looking flag, are never written.

use std::time::Instant;

const TARGET: &str = "proc.spawn";

/// Logs a spawn with its flags but no values.
pub fn spawned<S: AsRef<str>>(bin: &str, args: &[S]) {
    let shown = describe_args(args);
    tracing::debug!(target: TARGET, bin, args = ?shown, "spawned");
}

/// Logs an exit: DEBUG on a clean run, WARN otherwise.
pub fn exited(bin: &str, code: Option<i32>, started: Instant) {
    let dur_ms = started.elapsed().as_millis() as u64;
    if code == Some(0) {
        tracing::debug!(target: TARGET, bin, code, dur_ms, "exited");
    } else {
        tracing::warn!(target: TARGET, bin, code, dur_ms, "exited");
    }
}

/// Keeps flags, replaces every other value with `<value>`, and hides the value after a secret-looking flag.
fn describe_args<S: AsRef<str>>(args: &[S]) -> Vec<String> {
    let mut hide_next = false;
    args.iter()
        .map(|arg| {
            let arg = arg.as_ref();
            if hide_next {
                hide_next = false;
                return "<hidden>".to_owned();
            }
            if !arg.starts_with('-') {
                return "<value>".to_owned();
            }
            let flag = arg.split('=').next().unwrap_or(arg);
            let lower = flag.to_ascii_lowercase();
            let has_value = arg.contains('=');
            hide_next = !has_value
                && [
                    "key", "token", "secret", "pass", "auth", "prompt", "message",
                ]
                .iter()
                .any(|word| lower.contains(word));
            if has_value {
                format!("{flag}=<value>")
            } else {
                flag.chars().take(60).collect()
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::describe_args;

    #[test]
    fn keeps_flags_and_hides_values() {
        let shown = describe_args(&["--api-key", "abc", "--model=x", "run.py"]);
        assert_eq!(
            shown,
            ["--api-key", "<hidden>", "--model=<value>", "<value>"]
        );
    }
}
