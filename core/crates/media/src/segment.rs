//! Splits a stream of 64x36 grayscale samples into segments of frames that look the same. Pure logic, so the
//! thresholds are tested on synthetic frames without ffmpeg.

use serde::{Deserialize, Serialize};

use crate::VideoMeta;

/// Bump whenever the segmentation changes, so stored indexes are rebuilt.
pub const INDEX_VERSION: u32 = 1;
pub const PROXY_WIDTH: usize = 64;
pub const PROXY_HEIGHT: usize = 36;
pub const PROXY_BYTES: usize = PROXY_WIDTH * PROXY_HEIGHT;

/// A segment lasting at least this long is static; shorter ones are motion.
const STATIC_MIN_S: f64 = 1.0;
/// Cell brightness steps below this are noise, so flat areas do not flip hash bits.
const DHASH_MARGIN: u32 = 2;
/// This many single-sample segments in a row become one motion segment.
const COLLAPSE_MIN_RUN: usize = 3;

/// When a sample opens a new segment. Any one trigger is enough.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Thresholds {
    /// Mean absolute luma difference as a fraction of full scale.
    pub mean_diff: f64,
    /// Hamming distance between 64-bit dHashes.
    pub hash_bits: u32,
    /// A pixel counts as changed past this luma step (0-255); catches a cursor the mean washes out.
    pub pixel_delta: u8,
    /// How many changed pixels open a segment.
    pub pixel_count: usize,
}

impl Default for Thresholds {
    /// 1.5% mean and 4 hash bits per the plan; the pixel trigger catches a 12px cursor on a 160px wide video.
    /// 32 levels stays above x264 noise at crf 35 on the 64x36 proxy. Checked on three 2.5-5 minute screen recordings
    /// (typing, scrolling, idle): one segment per 2 s, 63-89% of the time static. The pixel trigger decides almost every
    /// split; the mean at 1-2.5% and 6 hash bits change the count by under 7%. Grain added at strength 25 to a slide video
    /// still gives the same 4 segments.
    fn default() -> Self {
        Self {
            mean_diff: 0.015,
            hash_bits: 4,
            pixel_delta: 32,
            pixel_count: 6,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SegmentKind {
    Static,
    Motion,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Segment {
    pub start_s: f64,
    pub end_s: f64,
    pub rep_s: f64,
    /// How much the sample that opened it differed from the segment before, 0 for the first.
    pub change_score: f64,
    pub kind: SegmentKind,
    /// How many changes a collapsed motion run holds; 1 otherwise.
    pub changes: u32,
}

impl Segment {
    fn new(start_s: f64, end_s: f64, change_score: f64, changes: u32) -> Self {
        let kind = if end_s - start_s >= STATIC_MIN_S && changes == 1 {
            SegmentKind::Static
        } else {
            SegmentKind::Motion
        };
        Self {
            start_s,
            end_s,
            rep_s: (start_s + end_s) / 2.0,
            change_score,
            kind,
            changes,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct VideoIndex {
    pub version: u32,
    pub meta: VideoMeta,
    pub threshold: Thresholds,
    pub sample_fps: f64,
    pub segments: Vec<Segment>,
}

struct Open {
    start_s: f64,
    change_score: f64,
}

pub struct Segmenter {
    thresholds: Thresholds,
    interval: f64,
    reference: Vec<u8>,
    reference_hash: u64,
    open: Option<Open>,
    closed: Vec<Segment>,
    last_s: f64,
}

impl Segmenter {
    pub fn new(thresholds: Thresholds, sample_fps: f64) -> Self {
        Self {
            thresholds,
            interval: 1.0 / sample_fps.max(0.01),
            reference: Vec::new(),
            reference_hash: 0,
            open: None,
            closed: Vec::new(),
            last_s: 0.0,
        }
    }

    /// One sample at `time_s`. A frame of the wrong size is ignored.
    pub fn push(&mut self, time_s: f64, frame: &[u8]) {
        if frame.len() != PROXY_BYTES {
            return;
        }
        self.last_s = time_s;
        let hash = dhash(frame);
        let Some(open) = &self.open else {
            self.open = Some(Open {
                start_s: time_s,
                change_score: 0.0,
            });
            self.reference = frame.to_vec();
            self.reference_hash = hash;
            return;
        };
        let mean = mean_diff(&self.reference, frame);
        let changed = changed_pixels(&self.reference, frame, self.thresholds.pixel_delta);
        let bits = (hash ^ self.reference_hash).count_ones();
        let opens = mean >= self.thresholds.mean_diff
            || bits >= self.thresholds.hash_bits
            || changed >= self.thresholds.pixel_count;
        if !opens {
            return;
        }
        self.closed
            .push(Segment::new(open.start_s, time_s, open.change_score, 1));
        self.open = Some(Open {
            start_s: time_s,
            change_score: mean.max(changed as f64 / PROXY_BYTES as f64),
        });
        self.reference.copy_from_slice(frame);
        self.reference_hash = hash;
    }

    /// Closes the last segment at the end of the video and folds runs of one-sample segments together.
    pub fn finish(mut self, duration_s: f64) -> Vec<Segment> {
        if let Some(open) = self.open.take() {
            let end = duration_s.max(self.last_s + self.interval.min(duration_s.max(0.0)));
            let end = if end > open.start_s {
                end
            } else {
                open.start_s + self.interval
            };
            self.closed
                .push(Segment::new(open.start_s, end, open.change_score, 1));
        }
        collapse(self.closed, self.interval)
    }
}

fn collapse(segments: Vec<Segment>, interval: f64) -> Vec<Segment> {
    // Anything shorter than a static stretch is part of a burst of change.
    let tiny =
        |segment: &Segment| segment.end_s - segment.start_s < STATIC_MIN_S.max(interval * 1.01);
    let mut out = Vec::with_capacity(segments.len());
    let mut run: Vec<Segment> = Vec::new();
    let flush = |run: &mut Vec<Segment>, out: &mut Vec<Segment>| {
        if run.len() >= COLLAPSE_MIN_RUN {
            let first = &run[0];
            let last = &run[run.len() - 1];
            let score = run.iter().map(|s| s.change_score).fold(0.0, f64::max);
            let changes = run.iter().map(|s| s.changes).sum();
            let mut merged = Segment::new(first.start_s, last.end_s, score, changes);
            merged.kind = SegmentKind::Motion;
            out.push(merged);
            run.clear();
        } else {
            out.append(run);
        }
    };
    for segment in segments {
        if tiny(&segment) {
            run.push(segment);
        } else {
            flush(&mut run, &mut out);
            out.push(segment);
        }
    }
    flush(&mut run, &mut out);
    out
}

fn mean_diff(a: &[u8], b: &[u8]) -> f64 {
    let total: u64 = a
        .iter()
        .zip(b)
        .map(|(x, y)| u64::from(x.abs_diff(*y)))
        .sum();
    total as f64 / (a.len().max(1) as f64 * 255.0)
}

fn changed_pixels(a: &[u8], b: &[u8], delta: u8) -> usize {
    a.iter()
        .zip(b)
        .filter(|(x, y)| x.abs_diff(**y) > delta)
        .count()
}

/// 64-bit difference hash: the proxy averaged down to 9x8, each bit says whether a cell is brighter than its right one.
fn dhash(frame: &[u8]) -> u64 {
    let mut cells = [[0u32; 9]; 8];
    for (row, line) in cells.iter_mut().enumerate() {
        let (y0, y1) = (
            row * PROXY_HEIGHT / 8,
            ((row + 1) * PROXY_HEIGHT / 8).max(row * PROXY_HEIGHT / 8 + 1),
        );
        for (col, cell) in line.iter_mut().enumerate() {
            let (x0, x1) = (col * PROXY_WIDTH / 9, (col + 1) * PROXY_WIDTH / 9);
            let mut sum = 0u32;
            for y in y0..y1 {
                for x in x0..x1 {
                    sum += u32::from(frame[y * PROXY_WIDTH + x]);
                }
            }
            *cell = sum / ((y1 - y0) * (x1 - x0)).max(1) as u32;
        }
    }
    let mut hash = 0u64;
    for line in &cells {
        for pair in line.windows(2) {
            hash = (hash << 1) | u64::from(pair[0] > pair[1] + DHASH_MARGIN);
        }
    }
    hash
}

/// The segments overlapping `start_s..end_s` worth showing, and how many more were left out.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Selection {
    pub shown: Vec<Segment>,
    pub skipped: usize,
}

/// Keeps the first and last overlapping segments and fills the rest with the biggest changes, in time order.
pub fn select_frames(segments: &[Segment], start_s: f64, end_s: f64, max: usize) -> Selection {
    let overlapping: Vec<&Segment> = segments
        .iter()
        .filter(|segment| segment.end_s > start_s && segment.start_s < end_s)
        .collect();
    let max = max.max(1);
    if overlapping.len() <= max {
        return Selection {
            shown: overlapping.into_iter().cloned().collect(),
            skipped: 0,
        };
    }
    let last = overlapping.len() - 1;
    let mut middle: Vec<usize> = (1..last).collect();
    middle.sort_by(|a, b| {
        overlapping[*b]
            .change_score
            .total_cmp(&overlapping[*a].change_score)
            .then(a.cmp(b))
    });
    let mut keep = vec![0];
    if max > 1 {
        keep.push(last);
    }
    keep.extend(middle.into_iter().take(max.saturating_sub(2)));
    keep.sort_unstable();
    Selection {
        shown: keep.iter().map(|&i| overlapping[i].clone()).collect(),
        skipped: overlapping.len() - keep.len(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flat(level: u8) -> Vec<u8> {
        vec![level; PROXY_BYTES]
    }

    /// A gray frame with a 4x4 bright box at `x`, about what a 12px cursor leaves on the proxy.
    fn with_box(x: usize) -> Vec<u8> {
        let mut frame = flat(100);
        for y in 16..20 {
            for dx in 0..4 {
                frame[y * PROXY_WIDTH + x + dx] = 230;
            }
        }
        frame
    }

    fn run(frames: &[Vec<u8>], fps: f64) -> Vec<Segment> {
        let mut segmenter = Segmenter::new(Thresholds::default(), fps);
        for (i, frame) in frames.iter().enumerate() {
            segmenter.push(i as f64 / fps, frame);
        }
        segmenter.finish(frames.len() as f64 / fps)
    }

    fn noisy(level: u8, seed: usize) -> Vec<u8> {
        (0..PROXY_BYTES)
            .map(|i| level.saturating_add(((i * 7 + seed * 13) % 5) as u8))
            .collect()
    }

    #[test]
    fn a_still_video_is_one_static_segment() {
        let frames: Vec<_> = (0..40).map(|i| noisy(90, i)).collect();
        let segments = run(&frames, 4.0);
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].kind, SegmentKind::Static);
        assert_eq!((segments[0].start_s, segments[0].end_s), (0.0, 10.0));
        assert_eq!(segments[0].rep_s, 5.0);
    }

    #[test]
    fn a_cut_opens_a_second_segment() {
        let mut frames = vec![flat(60); 20];
        frames.extend(vec![flat(180); 20]);
        let segments = run(&frames, 4.0);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[1].start_s, 5.0);
        assert!(segments[1].change_score > 0.4);
    }

    #[test]
    fn a_small_cursor_move_is_kept_apart() {
        let mut frames = vec![with_box(10); 8];
        frames.extend(vec![with_box(30); 8]);
        assert!(mean_diff(&with_box(10), &with_box(30)) < Thresholds::default().mean_diff);
        let segments = run(&frames, 4.0);
        assert_eq!(segments.len(), 2);
    }

    #[test]
    fn continuous_motion_between_stills_collapses_into_one_segment() {
        let mut frames = vec![with_box(4); 12];
        frames.extend((0..8).map(|i| with_box(8 + i * 5)));
        frames.extend(vec![with_box(48); 12]);
        let segments = run(&frames, 4.0);
        let kinds: Vec<_> = segments.iter().map(|s| s.kind).collect();
        assert_eq!(
            kinds,
            [
                SegmentKind::Static,
                SegmentKind::Motion,
                SegmentKind::Static
            ]
        );
        assert_eq!(segments[1].changes, 8);
        assert_eq!(segments[1].start_s, 3.0);
    }

    #[test]
    fn short_runs_of_change_are_not_collapsed() {
        let mut frames = vec![with_box(4); 8];
        frames.push(with_box(20));
        frames.extend(vec![with_box(40); 8]);
        let segments = run(&frames, 4.0);
        assert_eq!(segments.len(), 3);
        assert_eq!(segments[1].changes, 1);
        assert_eq!(segments[1].kind, SegmentKind::Motion);
    }

    #[test]
    fn a_frame_of_the_wrong_size_is_ignored() {
        let mut segmenter = Segmenter::new(Thresholds::default(), 4.0);
        segmenter.push(0.0, &[0u8; 10]);
        assert!(segmenter.finish(1.0).is_empty());
    }

    #[test]
    fn dhash_tells_a_gradient_from_its_mirror() {
        let ramp: Vec<u8> = (0..PROXY_BYTES)
            .map(|i| (i % PROXY_WIDTH * 4) as u8)
            .collect();
        let mirror: Vec<u8> = ramp.iter().map(|v| 255 - v).collect();
        assert_eq!((dhash(&ramp) ^ dhash(&mirror)).count_ones(), 64);
        assert_eq!(dhash(&flat(10)), 0);
    }

    fn seg(start: f64, end: f64, score: f64) -> Segment {
        Segment::new(start, end, score, 1)
    }

    #[test]
    fn select_returns_every_overlapping_segment_under_the_cap() {
        let segments = [seg(0.0, 5.0, 0.0), seg(5.0, 8.0, 0.2), seg(8.0, 12.0, 0.1)];
        let selection = select_frames(&segments, 4.0, 9.0, 8);
        assert_eq!(selection.shown.len(), 3);
        assert_eq!(selection.skipped, 0);
        let none = select_frames(&segments, 12.0, 20.0, 8);
        assert!(none.shown.is_empty());
    }

    #[test]
    fn select_keeps_ends_and_the_biggest_changes() {
        let scores = [0.0, 0.1, 0.9, 0.2, 0.8, 0.05, 0.3];
        let segments: Vec<_> = scores
            .iter()
            .enumerate()
            .map(|(i, s)| seg(i as f64, i as f64 + 1.0, *s))
            .collect();
        let selection = select_frames(&segments, 0.0, 7.0, 4);
        let starts: Vec<_> = selection.shown.iter().map(|s| s.start_s).collect();
        assert_eq!(starts, [0.0, 2.0, 4.0, 6.0]);
        assert_eq!(selection.skipped, 3);
        let one = select_frames(&segments, 0.0, 7.0, 1);
        assert_eq!(one.shown.len(), 1);
        assert_eq!(one.skipped, 6);
    }

    #[test]
    fn the_index_serialises_in_snake_case() {
        let json = serde_json::to_value(seg(0.0, 2.0, 0.0)).expect("serialises");
        assert_eq!(json["start_s"], 0.0);
        assert_eq!(json["kind"], "static");
        assert_eq!(json["change_score"], 0.0);
    }
}
