//! Single frames and contact sheets, encoded as JPEG by ffmpeg itself so the crate needs no image library.
//! Timestamps go in the tool's text result, which avoids a font dependency for drawn labels.

use std::ffi::OsString;
use std::path::Path;
use std::time::Duration;

use crate::run::output;
use crate::{FfmpegPaths, MediaError, VideoMeta};

const FRAME_TIMEOUT: Duration = Duration::from_secs(60);
/// Gap between contact sheet tiles, in pixels.
const TILE_GAP: u32 = 4;

/// Fits the frame inside `max_side` without enlarging it, then makes JPEG-ready full range pixels.
fn fit(max_side: u32) -> String {
    format!(
        "scale='min(iw,{max_side})':'min(ih,{max_side})':force_original_aspect_ratio=decrease,format=yuvj420p"
    )
}

fn base_args() -> Vec<OsString> {
    ["-hide_banner", "-loglevel", "error", "-nostdin"]
        .into_iter()
        .map(OsString::from)
        .collect()
}

fn jpeg_out(args: &mut Vec<OsString>) {
    args.extend(
        [
            "-frames:v",
            "1",
            "-f",
            "image2pipe",
            "-c:v",
            "mjpeg",
            "-q:v",
            "3",
            "-",
        ]
        .into_iter()
        .map(OsString::from),
    );
}

/// `-ss` sits before `-i` for a fast keyframe seek; ffmpeg still decodes up to the exact time.
pub async fn extract_frame(
    paths: &FfmpegPaths,
    file: &Path,
    time_s: f64,
    max_side: u32,
) -> Result<Vec<u8>, MediaError> {
    let mut args = base_args();
    args.extend([
        "-ss".into(),
        format!("{:.3}", time_s.max(0.0)).into(),
        "-i".into(),
        file.as_os_str().to_owned(),
        "-an".into(),
        "-vf".into(),
        fit(max_side).into(),
    ]);
    jpeg_out(&mut args);
    let bytes = output(&paths.ffmpeg, &args, FRAME_TIMEOUT).await?;
    if bytes.is_empty() {
        return Err(MediaError::NoFrame);
    }
    Ok(bytes)
}

pub async fn extract_frame_by_number(
    paths: &FfmpegPaths,
    file: &Path,
    frame: u64,
    fps: f64,
    max_side: u32,
) -> Result<Vec<u8>, MediaError> {
    let time_s = if fps > 0.0 { frame as f64 / fps } else { 0.0 };
    extract_frame(paths, file, time_s, max_side).await
}

/// Tile size inside a sheet `max_side` wide or tall, keeping the video's aspect.
pub(crate) fn tile_size(meta: &VideoMeta, count: usize, max_side: u32, cols: u32) -> (u32, u32) {
    let cols = cols.clamp(1, count.max(1) as u32);
    let rows = (count as u32).div_ceil(cols).max(1);
    let aspect = if meta.width > 0 && meta.height > 0 {
        f64::from(meta.width) / f64::from(meta.height)
    } else {
        16.0 / 9.0
    };
    let by_width = (max_side.saturating_sub(TILE_GAP * (cols - 1))) / cols;
    let by_height = (max_side.saturating_sub(TILE_GAP * (rows - 1))) / rows;
    let (mut w, mut h) = (f64::from(by_width), f64::from(by_width) / aspect);
    if h > f64::from(by_height) {
        h = f64::from(by_height);
        w = h * aspect;
    }
    let even = |value: f64| ((value as u32) & !1).max(2);
    (even(w), even(h))
}

/// Tiles one frame per time into a single JPEG, left to right then top to bottom.
pub async fn contact_sheet(
    paths: &FfmpegPaths,
    file: &Path,
    meta: &VideoMeta,
    times: &[f64],
    max_side: u32,
    cols: u32,
) -> Result<Vec<u8>, MediaError> {
    if times.is_empty() {
        return Err(MediaError::NoFrame);
    }
    let cols = cols.clamp(1, times.len() as u32);
    let rows = (times.len() as u32).div_ceil(cols);
    let (w, h) = tile_size(meta, times.len(), max_side, cols);
    let mut args = base_args();
    for time in times {
        args.extend([
            "-ss".into(),
            format!("{:.3}", time.max(0.0)).into(),
            "-i".into(),
            file.as_os_str().to_owned(),
        ]);
    }
    let mut graph = String::new();
    for index in 0..times.len() {
        graph.push_str(&format!(
            "[{index}:v]trim=end_frame=1,scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=N/TB[t{index}];"
        ));
    }
    for index in 0..times.len() {
        graph.push_str(&format!("[t{index}]"));
    }
    graph.push_str(&format!(
        "concat=n={}:v=1:a=0,tile={cols}x{rows}:padding={TILE_GAP}:color=black,format=yuvj420p[out]",
        times.len()
    ));
    args.extend([
        "-filter_complex".into(),
        graph.into(),
        "-map".into(),
        "[out]".into(),
    ]);
    jpeg_out(&mut args);
    let bytes = output(&paths.ffmpeg, &args, FRAME_TIMEOUT).await?;
    if bytes.is_empty() {
        return Err(MediaError::NoFrame);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(width: u32, height: u32) -> VideoMeta {
        VideoMeta {
            duration_s: 10.0,
            fps: 30.0,
            width,
            height,
            codec: "h264".into(),
            rotation: 0,
            has_audio: false,
            frame_count_estimate: 300,
        }
    }

    #[test]
    fn tiles_fit_the_sheet_and_keep_the_aspect() {
        let (w, h) = tile_size(&meta(1920, 1080), 8, 768, 4);
        assert!(w * 4 + TILE_GAP * 3 <= 768);
        assert!((f64::from(w) / f64::from(h) - 16.0 / 9.0).abs() < 0.05);
        let (pw, ph) = tile_size(&meta(1080, 1920), 4, 768, 4);
        assert!(ph > pw);
        assert!(ph <= 768 && pw % 2 == 0 && ph % 2 == 0);
    }

    #[test]
    fn the_fit_filter_never_enlarges() {
        assert!(fit(768).contains("min(iw,768)"));
    }
}
