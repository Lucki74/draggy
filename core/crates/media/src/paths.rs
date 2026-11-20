use std::path::{Path, PathBuf};

use crate::MediaError;

/// Where the two binaries live. The shell resolves them, so tests can point at any install.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FfmpegPaths {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
}

impl FfmpegPaths {
    /// The staged sidecars in `dir` first, then `PATH` when `allow_path` is set (debug builds only).
    pub fn find(dir: Option<&Path>, allow_path: bool) -> Result<Self, MediaError> {
        if let Some(found) = dir.and_then(Self::in_dir) {
            return Ok(found);
        }
        if allow_path && let Some(path) = std::env::var_os("PATH") {
            for entry in std::env::split_paths(&path) {
                if let Some(found) = Self::in_dir(&entry) {
                    return Ok(found);
                }
            }
        }
        Err(MediaError::FfmpegMissing)
    }

    fn in_dir(dir: &Path) -> Option<Self> {
        let ffmpeg = binary(dir, "ffmpeg");
        let ffprobe = binary(dir, "ffprobe");
        (ffmpeg.is_file() && ffprobe.is_file()).then_some(Self { ffmpeg, ffprobe })
    }
}

fn binary(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{name}{}", std::env::consts::EXE_SUFFIX))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_folder_without_both_binaries_is_skipped() {
        let dir = std::env::temp_dir().join(format!(
            "draggy-media-paths-{}",
            draggy_tools::spawn::current_pid()
        ));
        std::fs::create_dir_all(&dir).expect("temp dir");
        std::fs::write(binary(&dir, "ffmpeg"), b"").expect("write");
        assert!(FfmpegPaths::in_dir(&dir).is_none());
        std::fs::write(binary(&dir, "ffprobe"), b"").expect("write");
        let found = FfmpegPaths::find(Some(&dir), false).expect("found");
        assert_eq!(found.ffmpeg, binary(&dir, "ffmpeg"));
        std::fs::remove_dir_all(&dir).expect("cleanup");
    }

    #[test]
    fn a_missing_install_is_a_typed_error() {
        let dir = Path::new("definitely-not-a-folder-for-ffmpeg");
        let error = FfmpegPaths::find(Some(dir), false).unwrap_err();
        assert_eq!(error.code(), "E_FFMPEG_MISSING");
    }
}
