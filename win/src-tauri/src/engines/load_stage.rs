//! Turns llama-server output into the load steps the prompt shows.
//! Every number is one the engine reported.

use std::sync::{Arc, LazyLock, Mutex, PoisonError};
use std::time::Instant;

use draggy_engine::llama_process::LoadWatch;
use regex::Regex;
use serde_json::{Value, json};

const STEP: i64 = 3;

/// Steps of 3 percent, held below 100 so a step never claims to be done before the next one starts.
pub fn round_down(percent: i64) -> i64 {
    ((percent / STEP) * STEP).clamp(0, 99)
}

#[derive(Debug, Clone, PartialEq)]
pub enum Stage {
    Disk,
    Loading(i64),
    Readying,
    Reading { tokens: i64, percent: i64 },
}

static LOADING: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)srv\s+load_model: loading model").ok());
static LOADED: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)llama_server: model loaded").ok());
static PREFILL: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(r"(?i)prompt processing, n_tokens = (\d+), progress = ([0-9.]+)").ok()
});

/// What one line of engine output marks, if anything.
pub fn parse_engine_stage(line: &str) -> Option<Stage> {
    if LOADING.as_ref().is_some_and(|re| re.is_match(line)) {
        return Some(Stage::Disk);
    }
    if LOADED.as_ref().is_some_and(|re| re.is_match(line)) {
        return Some(Stage::Readying);
    }
    let caps = PREFILL.as_ref()?.captures(line)?;
    let tokens = caps.get(1)?.as_str().parse::<i64>().ok()?;
    let progress = caps.get(2)?.as_str().parse::<f64>().ok()?;
    Some(Stage::Reading {
        tokens,
        percent: ((progress * 100.0).round() as i64).min(100),
    })
}

/// Progress dots in a piece of output: one per percent of weights loaded.
pub fn count_load_dots(chunk: &str) -> i64 {
    chunk
        .split('\n')
        .map(str::trim)
        .filter(|piece| !piece.is_empty() && piece.bytes().all(|b| b == b'.'))
        .map(|piece| piece.len() as i64)
        .sum()
}

/// Follows one prompt's wait and hands each new step to `emit`.
pub struct LoadProgress<E: FnMut(Value)> {
    emit: E,
    current: Option<&'static str>,
    last_percent: i64,
    read_start: Option<(u64, i64)>,
}

impl<E: FnMut(Value)> LoadProgress<E> {
    pub fn new(emit: E) -> Self {
        Self {
            emit,
            current: None,
            last_percent: -1,
            read_start: None,
        }
    }

    fn push(&mut self, stage: &'static str, percent: Option<i64>) {
        if self.current == Some(stage) && percent.unwrap_or(-1) == self.last_percent {
            return;
        }
        self.current = Some(stage);
        self.last_percent = percent.unwrap_or(-1);
        let mut event = json!({ "stage": stage });
        if let Some(percent) = percent {
            event["percent"] = json!(percent);
        }
        (self.emit)(event);
    }

    /// Takes a stage the engine log marked; `now_ms` is the clock.
    pub fn handle(&mut self, stage: &Stage, now_ms: u64) {
        match stage {
            Stage::Disk => {
                self.read_start = None;
                self.push("disk", None);
            }
            Stage::Loading(percent) => self.push("loading", Some(round_down(*percent))),
            Stage::Readying => self.push("readying", None),
            Stage::Reading { tokens, percent } => {
                if *percent >= 100 {
                    self.read_start = None;
                    self.push("readying", None);
                    return;
                }
                let (start_at, start_tokens) = *self.read_start.get_or_insert((now_ms, *tokens));
                let seconds = now_ms.saturating_sub(start_at) as f64 / 1000.0;
                let gained = tokens - start_tokens;
                let rounded = round_down(*percent);
                let speed =
                    (seconds > 0.0 && gained > 0).then(|| (gained as f64 / seconds).round() as i64);
                if self.current == Some("reading") && rounded == self.last_percent {
                    return;
                }
                self.current = Some("reading");
                self.last_percent = rounded;
                let mut event = json!({ "stage": "reading", "percent": rounded });
                if let Some(speed) = speed {
                    event["tokensPerSecond"] = json!(speed);
                }
                (self.emit)(event);
            }
        }
    }

    pub fn stop(&mut self) {
        self.current = None;
        self.last_percent = -1;
        self.read_start = None;
    }
}

type Sink = Arc<dyn Fn(Value) + Send + Sync>;

type Tracker = LoadProgress<Box<dyn FnMut(Value) + Send>>;

struct Inner {
    progress: Option<Tracker>,
    dots: i64,
}

/// The [`LoadWatch`] a model start hands the supervisor; stages go to `sink` (the `gguf:stage` event).
pub struct StageWatch {
    inner: Mutex<Inner>,
    sink: Sink,
    started: Instant,
}

impl std::fmt::Debug for StageWatch {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("StageWatch")
    }
}

impl StageWatch {
    pub fn new(sink: impl Fn(Value) + Send + Sync + 'static) -> Self {
        Self {
            inner: Mutex::new(Inner {
                progress: None,
                dots: 0,
            }),
            sink: Arc::new(sink),
            started: Instant::now(),
        }
    }

    fn tracker(&self) -> Tracker {
        let sink = Arc::clone(&self.sink);
        LoadProgress::new(Box::new(move |event| sink(event)))
    }
}

impl LoadWatch for StageWatch {
    fn spawned(&self, _pid: u32) {}

    fn line(&self, line: &str) {
        let now = self.started.elapsed().as_millis() as u64;
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(stage) = parse_engine_stage(line) {
            if stage == Stage::Disk {
                inner.dots = 0;
                if let Some(old) = inner.progress.as_mut() {
                    old.stop();
                }
                inner.progress = Some(self.tracker());
            }
            if inner.progress.is_none() {
                inner.progress = Some(self.tracker());
            }
            if let Some(progress) = inner.progress.as_mut() {
                progress.handle(&stage, now);
            }
            return;
        }
        let dots = count_load_dots(line);
        if dots == 0 {
            return;
        }
        inner.dots = (inner.dots + dots).min(100);
        let total = inner.dots;
        if let Some(progress) = inner.progress.as_mut() {
            progress.handle(&Stage::Loading(total), now);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collect(stages: &[(Stage, u64)]) -> Vec<Value> {
        let events = std::cell::RefCell::new(Vec::new());
        let mut progress = LoadProgress::new(|event| events.borrow_mut().push(event));
        for (stage, at) in stages {
            progress.handle(stage, *at);
        }
        events.into_inner()
    }

    #[test]
    fn percent_steps_down_to_three_and_stay_below_100() {
        assert_eq!(round_down(0), 0);
        assert_eq!(round_down(7), 6);
        assert_eq!(round_down(100), 99);
        assert_eq!(round_down(-4), 0);
    }

    #[test]
    fn engine_lines_map_to_stages() {
        assert_eq!(
            parse_engine_stage("srv  load_model: loading model x"),
            Some(Stage::Disk)
        );
        assert_eq!(
            parse_engine_stage("main: llama_server: model loaded"),
            Some(Stage::Readying)
        );
        assert_eq!(
            parse_engine_stage(
                "slot update_slots: prompt processing, n_tokens = 512, progress = 0.256"
            ),
            Some(Stage::Reading {
                tokens: 512,
                percent: 26
            })
        );
        assert_eq!(parse_engine_stage("something else"), None);
    }

    #[test]
    fn dots_count_only_dot_only_lines() {
        assert_eq!(count_load_dots("....\r\nabc\n.."), 6);
        assert_eq!(count_load_dots("a.b"), 0);
    }

    #[test]
    fn repeated_steps_are_not_emitted_twice() {
        let events = collect(&[
            (Stage::Disk, 0),
            (Stage::Disk, 1),
            (Stage::Loading(4), 2),
            (Stage::Loading(5), 3),
            (Stage::Loading(6), 4),
        ]);
        assert_eq!(
            events,
            vec![
                json!({"stage": "disk"}),
                json!({"stage": "loading", "percent": 3}),
                json!({"stage": "loading", "percent": 6}),
            ]
        );
    }

    #[test]
    fn reading_reports_speed_once_it_has_a_baseline() {
        let events = collect(&[
            (
                Stage::Reading {
                    tokens: 100,
                    percent: 10,
                },
                0,
            ),
            (
                Stage::Reading {
                    tokens: 300,
                    percent: 40,
                },
                2000,
            ),
            (
                Stage::Reading {
                    tokens: 400,
                    percent: 100,
                },
                3000,
            ),
        ]);
        assert_eq!(events[0], json!({"stage": "reading", "percent": 9}));
        assert_eq!(
            events[1],
            json!({"stage": "reading", "percent": 39, "tokensPerSecond": 100})
        );
        assert_eq!(events[2], json!({"stage": "readying"}));
    }
}
