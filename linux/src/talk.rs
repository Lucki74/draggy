//! Talk mode: record one spoken message with sox, turn it into text with whisper.cpp, and let the chat send it.
//! Both tools have to be installed, and whisper needs a ggml model file.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// The longest a single spoken message can run, in seconds.
const LONGEST: u32 = 30;

/// Where the whisper model is looked for: `DRAGGY_WHISPER_MODEL`, else the data folder.
pub fn model_path() -> PathBuf {
    if let Some(path) = std::env::var_os("DRAGGY_WHISPER_MODEL") {
        return PathBuf::from(path);
    }
    let data = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| Path::new(&home).join(".local/share")))
        .unwrap_or_default();
    data.join("draggy/whisper/ggml-base.bin")
}

/// The `rec` arguments: 16 kHz mono, stopping after 1.5 seconds of quiet once speech has started.
pub fn record_args(wav: &Path) -> Vec<String> {
    let mut args: Vec<String> = ["-q", "-r", "16000", "-c", "1", "-b", "16"]
        .map(String::from)
        .into();
    args.push(wav.display().to_string());
    args.extend(["silence", "1", "0.1", "3%", "1", "1.5", "3%", "trim", "0"].map(String::from));
    args.push(LONGEST.to_string());
    args
}

/// The `whisper-cli` arguments: plain text out, no timestamps.
pub fn transcribe_args(model: &Path, wav: &Path) -> Vec<String> {
    vec![
        "-m".into(),
        model.display().to_string(),
        "-f".into(),
        wav.display().to_string(),
        "-nt".into(),
        "-np".into(),
    ]
}

/// The spoken words from whisper's output, without its markers for silence and noise.
pub fn clean(output: &str) -> String {
    output
        .lines()
        .map(str::trim)
        .filter(|row| !row.is_empty())
        .filter(|row| !(row.starts_with('[') && row.ends_with(']')))
        .filter(|row| !(row.starts_with('(') && row.ends_with(')')))
        .collect::<Vec<_>>()
        .join(" ")
}

fn installed(tool: &str) -> bool {
    Command::new(tool)
        .arg("--help")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok()
}

/// What talk mode still needs, or None when everything is in place.
pub fn missing() -> Option<String> {
    if !installed("rec") {
        return Some("Install sox to talk.".into());
    }
    if !installed("whisper-cli") {
        return Some("Install whisper.cpp to talk.".into());
    }
    let model = model_path();
    if !model.exists() {
        return Some(format!("Put a whisper model at {}.", model.display()));
    }
    None
}

/// Records one message and returns what was said, empty when nothing was heard. Blocks until the speaker pauses.
pub fn listen() -> Result<String, String> {
    let wav = std::env::temp_dir().join(format!("draggy-talk-{}.wav", std::process::id()));
    let recorded = Command::new("rec")
        .args(record_args(&wav))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| e.to_string())?;
    if !recorded.success() {
        let _ = std::fs::remove_file(&wav);
        return Err("The recording failed.".into());
    }
    let out = Command::new("whisper-cli")
        .args(transcribe_args(&model_path(), &wav))
        .stderr(Stdio::null())
        .output()
        .map_err(|e| e.to_string());
    let _ = std::fs::remove_file(&wav);
    Ok(clean(&String::from_utf8_lossy(&out?.stdout)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recording_stops_on_quiet_and_is_capped() {
        let args = record_args(Path::new("/tmp/a.wav"));
        assert_eq!(args[..7], ["-q", "-r", "16000", "-c", "1", "-b", "16"]);
        assert!(args.contains(&"silence".to_string()));
        assert_eq!(args.last().unwrap(), "30");
    }

    #[test]
    fn transcribing_names_the_model_and_the_file() {
        let args = transcribe_args(Path::new("m.bin"), Path::new("a.wav"));
        assert_eq!(args[..4], ["-m", "m.bin", "-f", "a.wav"]);
    }

    #[test]
    fn silence_markers_are_not_words() {
        assert_eq!(clean("[BLANK_AUDIO]\n"), "");
        assert_eq!(
            clean(" Hello there \n(music)\n how are you\n"),
            "Hello there how are you"
        );
    }
}
