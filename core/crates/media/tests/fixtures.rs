//! Runs the real ffmpeg against shared/fixtures/video. Skips with a note when no ffmpeg is found.

use std::path::{Path, PathBuf};

use draggy_media::{
    CancelToken, FfmpegPaths, IndexOptions, SegmentKind, contact_sheet, extract_frame, index, probe,
};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn fixture(name: &str) -> PathBuf {
    root().join("shared/fixtures/video").join(name)
}

/// DRAGGY_FFMPEG_DIR, then the dev vendor folder, then PATH.
fn ffmpeg() -> Option<FfmpegPaths> {
    let env_dir = std::env::var_os("DRAGGY_FFMPEG_DIR").map(PathBuf::from);
    let vendor = root().join("win/vendor/ffmpeg");
    for dir in [env_dir.as_deref(), Some(vendor.as_path())] {
        if let Some(dir) = dir
            && let Ok(paths) = FfmpegPaths::find(Some(dir), false)
        {
            return Some(paths);
        }
    }
    let found = FfmpegPaths::find(None, true).ok();
    if found.is_none() {
        eprintln!("skipping: no ffmpeg found");
    }
    found
}

async fn segments_of(paths: &FfmpegPaths, name: &str) -> Vec<draggy_media::Segment> {
    let file = fixture(name);
    let meta = probe(paths, &file).await.expect("probes");
    let built = index(
        paths,
        &file,
        &meta,
        IndexOptions::for_meta(&meta),
        |_| {},
        &CancelToken::new(),
    )
    .await
    .expect("indexes");
    built.segments
}

#[tokio::test]
async fn a_still_video_is_one_segment() {
    let Some(paths) = ffmpeg() else { return };
    let segments = segments_of(&paths, "still.mp4").await;
    assert_eq!(segments.len(), 1, "{segments:?}");
    assert_eq!(segments[0].kind, SegmentKind::Static);
}

#[tokio::test]
async fn a_hard_cut_makes_two_segments() {
    let Some(paths) = ffmpeg() else { return };
    let segments = segments_of(&paths, "two-scenes.mp4").await;
    assert_eq!(segments.len(), 2, "{segments:?}");
}

#[tokio::test]
async fn a_moving_box_is_still_then_motion_then_still() {
    let Some(paths) = ffmpeg() else { return };
    let segments = segments_of(&paths, "cursor.mp4").await;
    let kinds: Vec<_> = segments.iter().map(|segment| segment.kind).collect();
    assert_eq!(
        kinds,
        [
            SegmentKind::Static,
            SegmentKind::Motion,
            SegmentKind::Static
        ],
        "{segments:?}"
    );
}

#[tokio::test]
async fn continuous_motion_collapses() {
    let Some(paths) = ffmpeg() else { return };
    let segments = segments_of(&paths, "testsrc.mp4").await;
    assert!(segments.len() <= 2, "{segments:?}");
    assert!(
        segments
            .iter()
            .any(|segment| segment.kind == SegmentKind::Motion)
    );
}

#[tokio::test]
async fn a_rotated_video_reports_its_displayed_size() {
    let Some(paths) = ffmpeg() else { return };
    let meta = probe(&paths, &fixture("portrait.mov"))
        .await
        .expect("probes");
    assert_eq!((meta.width, meta.height), (90, 160));
}

#[tokio::test]
async fn audio_only_is_refused() {
    let Some(paths) = ffmpeg() else { return };
    let error = probe(&paths, &fixture("no-video.m4a")).await.unwrap_err();
    assert_eq!(error.code(), "E_NO_VIDEO_STREAM");
}

#[tokio::test]
async fn frames_and_sheets_come_back_as_jpeg() {
    let Some(paths) = ffmpeg() else { return };
    let file = fixture("two-scenes.mp4");
    let meta = probe(&paths, &file).await.expect("probes");
    let frame = extract_frame(&paths, &file, 1.0, 768).await.expect("frame");
    assert_eq!(&frame[..2], [0xFF, 0xD8]);
    let sheet = contact_sheet(&paths, &file, &meta, &[0.5, 1.5, 2.5, 3.5], 768, 2)
        .await
        .expect("sheet");
    assert_eq!(&sheet[..2], [0xFF, 0xD8]);
}

#[tokio::test]
async fn cancelling_stops_indexing() {
    let Some(paths) = ffmpeg() else { return };
    let file = fixture("testsrc.mp4");
    let meta = probe(&paths, &file).await.expect("probes");
    let cancel = CancelToken::new();
    cancel.cancel();
    let error = index(
        &paths,
        &file,
        &meta,
        IndexOptions::for_meta(&meta),
        |_| {},
        &cancel,
    )
    .await
    .unwrap_err();
    assert_eq!(error.code(), "E_CANCELLED");
}
