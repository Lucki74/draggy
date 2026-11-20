use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::run::output;
use crate::{FfmpegPaths, MAX_DURATION_S, MediaError};

const PROBE_TIMEOUT: Duration = Duration::from_secs(30);

/// What ffprobe reports, with width and height as displayed once rotation is applied.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct VideoMeta {
    pub duration_s: f64,
    pub fps: f64,
    pub width: u32,
    pub height: u32,
    pub codec: String,
    pub rotation: u32,
    pub has_audio: bool,
    pub frame_count_estimate: u64,
}

pub async fn probe(paths: &FfmpegPaths, file: &Path) -> Result<VideoMeta, MediaError> {
    let args = [
        "-v".as_ref(),
        "error".as_ref(),
        "-print_format".as_ref(),
        "json".as_ref(),
        "-show_streams".as_ref(),
        "-show_format".as_ref(),
        file.as_os_str(),
    ];
    let bytes = output(&paths.ffprobe, &args, PROBE_TIMEOUT).await?;
    let json: Value =
        serde_json::from_slice(&bytes).map_err(|error| MediaError::Probe(error.to_string()))?;
    parse_probe(&json)
}

/// Turns ffprobe's JSON into metadata. Cover art counts as no video, so an m4a with a picture is refused.
pub fn parse_probe(json: &Value) -> Result<VideoMeta, MediaError> {
    let streams = json
        .get("streams")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let is_type = |stream: &&Value, kind: &str| {
        stream.get("codec_type").and_then(Value::as_str) == Some(kind)
    };
    let video = streams
        .iter()
        .find(|stream| {
            is_type(stream, "video")
                && stream
                    .pointer("/disposition/attached_pic")
                    .and_then(Value::as_i64)
                    != Some(1)
        })
        .ok_or(MediaError::NoVideoStream)?;
    let has_audio = streams.iter().any(|stream| is_type(&stream, "audio"));

    let fps = rate(video.get("avg_frame_rate"))
        .or_else(|| rate(video.get("r_frame_rate")))
        .unwrap_or(0.0);
    let duration_s = number(video.get("duration"))
        .or_else(|| number(json.pointer("/format/duration")))
        .unwrap_or(0.0);
    if duration_s > MAX_DURATION_S {
        return Err(MediaError::TooLong(duration_s));
    }
    let rotation = rotation_of(video);
    let (mut width, mut height) = (dimension(video, "width"), dimension(video, "height"));
    if rotation % 180 == 90 {
        std::mem::swap(&mut width, &mut height);
    }
    let frame_count_estimate = number(video.get("nb_frames"))
        .map(|frames| frames as u64)
        .unwrap_or_else(|| (duration_s * fps).round() as u64);
    Ok(VideoMeta {
        duration_s,
        fps,
        width,
        height,
        codec: video
            .get("codec_name")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_owned(),
        rotation,
        has_audio,
        frame_count_estimate,
    })
}

fn dimension(stream: &Value, key: &str) -> u32 {
    stream
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or(0)
}

/// ffprobe writes numbers as strings ("12.5") in some fields and as numbers in others.
fn number(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.parse().ok(),
        _ => None,
    }
    .filter(|value: &f64| value.is_finite() && *value >= 0.0)
}

/// "30000/1001" style rates; "0/0" means unknown.
fn rate(value: Option<&Value>) -> Option<f64> {
    let text = value?.as_str()?;
    let (num, den) = text.split_once('/').unwrap_or((text, "1"));
    let (num, den): (f64, f64) = (num.parse().ok()?, den.parse().ok()?);
    (den > 0.0 && num > 0.0).then(|| num / den)
}

/// Older files carry a `rotate` tag; newer ffprobe reports a display matrix in side data, counter-clockwise.
fn rotation_of(stream: &Value) -> u32 {
    let raw = stream
        .pointer("/tags/rotate")
        .and_then(|value| number(Some(value)).or_else(|| value.as_str()?.parse().ok()))
        .or_else(|| {
            stream
                .get("side_data_list")?
                .as_array()?
                .iter()
                .find_map(|item| item.get("rotation")?.as_f64())
        })
        .unwrap_or(0.0);
    (raw.round() as i64).rem_euclid(360) as u32
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample(extra: Value) -> Value {
        let mut video = json!({
            "codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080,
            "avg_frame_rate": "30000/1001", "duration": "134.5", "nb_frames": "4031"
        });
        if let (Some(target), Some(extra)) = (video.as_object_mut(), extra.as_object()) {
            target.extend(extra.clone());
        }
        json!({ "streams": [video, { "codec_type": "audio" }], "format": { "duration": "134.6" } })
    }

    #[test]
    fn reads_a_landscape_video() {
        let meta = parse_probe(&sample(json!({}))).expect("parses");
        assert_eq!((meta.width, meta.height), (1920, 1080));
        assert!((meta.fps - 29.97).abs() < 0.01);
        assert_eq!(meta.duration_s, 134.5);
        assert_eq!(meta.frame_count_estimate, 4031);
        assert!(meta.has_audio);
        assert_eq!(meta.codec, "h264");
    }

    #[test]
    fn a_rotated_phone_video_reports_the_displayed_size() {
        let meta = parse_probe(&sample(json!({ "side_data_list": [{ "rotation": -90 }] })))
            .expect("parses");
        assert_eq!(meta.rotation, 270);
        assert_eq!((meta.width, meta.height), (1080, 1920));
        let tagged = parse_probe(&sample(json!({ "tags": { "rotate": "90" } }))).expect("parses");
        assert_eq!((tagged.width, tagged.height), (1080, 1920));
    }

    #[test]
    fn audio_only_and_cover_art_have_no_video_stream() {
        let audio = json!({ "streams": [{ "codec_type": "audio" }] });
        assert_eq!(parse_probe(&audio).unwrap_err().code(), "E_NO_VIDEO_STREAM");
        let cover = json!({ "streams": [
            { "codec_type": "audio" },
            { "codec_type": "video", "disposition": { "attached_pic": 1 } }
        ] });
        assert_eq!(parse_probe(&cover).unwrap_err().code(), "E_NO_VIDEO_STREAM");
    }

    #[test]
    fn a_video_over_four_hours_is_refused() {
        let long = sample(json!({ "duration": "20000" }));
        assert_eq!(parse_probe(&long).unwrap_err().code(), "E_VIDEO_TOO_LONG");
    }

    #[test]
    fn missing_counts_fall_back_to_duration_times_rate() {
        let mut json =
            sample(json!({ "duration": null, "avg_frame_rate": "0/0", "r_frame_rate": "25/1" }));
        json["streams"][0]
            .as_object_mut()
            .expect("object")
            .remove("nb_frames");
        let meta = parse_probe(&json).expect("parses");
        assert_eq!(meta.duration_s, 134.6);
        assert_eq!(meta.fps, 25.0);
        assert_eq!(meta.frame_count_estimate, 3365);
    }
}
