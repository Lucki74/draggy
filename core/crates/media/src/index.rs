use std::path::Path;
use std::time::{Duration, Instant};

use tokio::io::AsyncReadExt;

use crate::run::{failure, read_tail, start};
use crate::{
    CancelToken, FfmpegPaths, INDEX_VERSION, MediaError, PROXY_BYTES, PROXY_HEIGHT, PROXY_WIDTH,
    SAMPLE_FPS, Segmenter, Thresholds, VideoIndex, VideoMeta,
};

/// Progress is reported about this often.
const PROGRESS_EVERY: Duration = Duration::from_millis(250);

#[derive(Clone, Copy, Debug)]
pub struct IndexOptions {
    pub sample_fps: f64,
    pub thresholds: Thresholds,
}

impl IndexOptions {
    /// 4 fps, or the source rate when it is lower.
    pub fn for_meta(meta: &VideoMeta) -> Self {
        let sample_fps = if meta.fps > 0.0 {
            meta.fps.min(SAMPLE_FPS)
        } else {
            SAMPLE_FPS
        };
        Self {
            sample_fps,
            thresholds: Thresholds::default(),
        }
    }
}

/// Decodes the video once at the sample rate into 64x36 gray frames and segments them as they arrive.
pub async fn index(
    paths: &FfmpegPaths,
    file: &Path,
    meta: &VideoMeta,
    options: IndexOptions,
    mut progress: impl FnMut(f64),
    cancel: &CancelToken,
) -> Result<VideoIndex, MediaError> {
    if cancel.is_cancelled() {
        return Err(MediaError::Cancelled);
    }
    let filter = format!(
        "fps={},scale={PROXY_WIDTH}:{PROXY_HEIGHT}:flags=area,format=gray",
        options.sample_fps
    );
    let args = [
        "-hide_banner".as_ref(),
        "-loglevel".as_ref(),
        "error".as_ref(),
        "-nostdin".as_ref(),
        "-i".as_ref(),
        file.as_os_str(),
        "-an".as_ref(),
        "-sn".as_ref(),
        "-vf".as_ref(),
        filter.as_ref(),
        "-f".as_ref(),
        "rawvideo".as_ref(),
        "-".as_ref(),
    ];
    let mut child = start(&paths.ffmpeg, &args)?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| MediaError::Io(std::io::Error::other("ffmpeg stdout is not piped")))?;
    let stderr = child.stderr.take();
    let stderr_task = tokio::spawn(async move {
        match stderr {
            Some(pipe) => read_tail(pipe).await,
            None => Vec::new(),
        }
    });

    let mut segmenter = Segmenter::new(options.thresholds, options.sample_fps);
    let mut frame = vec![0u8; PROXY_BYTES];
    let mut sample = 0u64;
    let mut reported = Instant::now();
    let duration = meta.duration_s.max(0.001);
    loop {
        let read = tokio::select! {
            read = stdout.read_exact(&mut frame) => read,
            () = cancel.cancelled() => {
                let _ = child.kill().await;
                stderr_task.abort();
                return Err(MediaError::Cancelled);
            }
        };
        match read {
            Ok(_) => {
                let time_s = sample as f64 / options.sample_fps;
                segmenter.push(time_s, &frame);
                sample += 1;
                if reported.elapsed() >= PROGRESS_EVERY {
                    reported = Instant::now();
                    progress((time_s / duration).clamp(0.0, 1.0));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(error) => {
                let _ = child.kill().await;
                return Err(MediaError::Io(error));
            }
        }
    }
    let status = child.wait().await?;
    let tail = stderr_task.await.unwrap_or_default();
    if !status.success() {
        return Err(failure(status.code(), &tail));
    }
    progress(1.0);
    Ok(VideoIndex {
        version: INDEX_VERSION,
        meta: meta.clone(),
        threshold: options.thresholds,
        sample_fps: options.sample_fps,
        segments: segmenter.finish(meta.duration_s),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(fps: f64) -> VideoMeta {
        VideoMeta {
            duration_s: 10.0,
            fps,
            width: 64,
            height: 36,
            codec: "h264".into(),
            rotation: 0,
            has_audio: false,
            frame_count_estimate: 0,
        }
    }

    #[test]
    fn samples_at_four_fps_or_the_lower_source_rate() {
        assert_eq!(IndexOptions::for_meta(&meta(30.0)).sample_fps, 4.0);
        assert_eq!(IndexOptions::for_meta(&meta(2.0)).sample_fps, 2.0);
        assert_eq!(IndexOptions::for_meta(&meta(0.0)).sample_fps, 4.0);
    }
}
