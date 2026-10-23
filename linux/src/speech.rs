//! Reading replies aloud through speech-dispatcher, when `spd-say` is installed.

use std::process::{Command, Stdio};

/// The text with markdown marks and code blocks taken out, since they read badly aloud.
pub fn spoken(markdown: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut in_fence = false;
    for row in markdown.lines() {
        if row.trim_start().starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        let plain: String = row
            .chars()
            .filter(|c| !matches!(c, '`' | '*' | '#'))
            .collect();
        let plain = plain.trim();
        if !plain.is_empty() {
            out.push(plain.to_owned());
        }
    }
    out.join(". ")
}

/// Whether speech-dispatcher's `spd-say` can be run.
pub fn available() -> bool {
    Command::new("spd-say")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok()
}

/// Starts reading the reply, replacing anything still being read. False when speech-dispatcher is not installed.
pub fn speak(markdown: &str) -> bool {
    stop();
    let text = spoken(markdown);
    if text.is_empty() {
        return true;
    }
    Command::new("spd-say")
        .arg("--")
        .arg(text)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok()
}

/// Cuts off what is being read.
pub fn stop() {
    let _ = Command::new("spd-say")
        .arg("--stop")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_blocks_and_marks_are_not_spoken() {
        let text = spoken("# Title\nSome **bold** and `code`.\n```rust\nlet x = 1;\n```\nDone");
        assert_eq!(text, "Title. Some bold and code.. Done");
    }

    #[test]
    fn an_empty_reply_says_nothing() {
        assert_eq!(spoken("```\nonly code\n```"), "");
    }
}
