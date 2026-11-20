//! Runs ffmpeg or ffprobe to the end and keeps stdout as bytes, since frames come back as JPEG on stdout.

use std::ffi::OsStr;
use std::path::Path;
use std::time::Duration;

use draggy_tools::spawn::{Child, spawn_hidden};
use tokio::io::{AsyncRead, AsyncReadExt};

use crate::MediaError;

/// How much of stderr an error keeps.
pub(crate) const STDERR_TAIL: usize = 2048;

pub(crate) fn start<S: AsRef<OsStr>>(program: &Path, args: &[S]) -> Result<Child, MediaError> {
    spawn_hidden(program, args, |_| {}).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            MediaError::FfmpegMissing
        } else {
            MediaError::Io(error)
        }
    })
}

/// Reads a pipe to the end, keeping only the last `STDERR_TAIL` bytes.
pub(crate) async fn read_tail<R: AsyncRead + Unpin>(mut pipe: R) -> Vec<u8> {
    let mut tail = Vec::new();
    let mut buffer = [0u8; 4096];
    while let Ok(count) = pipe.read(&mut buffer).await {
        if count == 0 {
            break;
        }
        tail.extend_from_slice(&buffer[..count]);
        if tail.len() > STDERR_TAIL {
            tail.drain(..tail.len() - STDERR_TAIL);
        }
    }
    tail
}

pub(crate) fn failure(code: Option<i32>, stderr: &[u8]) -> MediaError {
    MediaError::Failed {
        code,
        stderr: String::from_utf8_lossy(stderr).trim().to_owned(),
    }
}

/// Stdout of a successful run. A timeout drops the child, which kills it.
pub(crate) async fn output<S: AsRef<OsStr>>(
    program: &Path,
    args: &[S],
    timeout: Duration,
) -> Result<Vec<u8>, MediaError> {
    let mut child = start(program, args)?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let work = async {
        let read_out = async {
            let mut bytes = Vec::new();
            if let Some(mut pipe) = stdout {
                pipe.read_to_end(&mut bytes).await?;
            }
            Ok::<_, std::io::Error>(bytes)
        };
        let read_err = async {
            match stderr {
                Some(pipe) => read_tail(pipe).await,
                None => Vec::new(),
            }
        };
        let (bytes, tail) = tokio::join!(read_out, read_err);
        let status = child.wait().await?;
        if status.success() {
            Ok(bytes?)
        } else {
            Err(failure(status.code(), &tail))
        }
    };
    tokio::time::timeout(timeout, work)
        .await
        .map_err(|_| MediaError::Timeout)?
}
