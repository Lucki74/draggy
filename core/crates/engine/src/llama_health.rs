//! Asks the local llama-server whether it answers and what model it holds, and waits for it. Network and time sit behind traits.
//! Port of pingHealth, servedModel and waitForReady in electron/llamaProcess.cjs.

use std::future::Future;
use std::time::{Duration, Instant};

use draggy_models::shards::basename;
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// Interval between readiness checks while the weights load.
const POLL_INTERVAL: Duration = Duration::from_millis(500);
/// A single readiness check gives up after this long.
const CHECK_TIMEOUT: Duration = Duration::from_millis(1500);

/// The questions the supervisor asks a server on a loopback port.
pub trait HealthProbe: Send + Sync + 'static {
    /// True when the server answers `/health` with HTTP 200 within the timeout.
    fn healthy(&self, port: u16, timeout: Duration) -> impl Future<Output = bool> + Send;
    /// The model the server says it holds, or None when it does not say.
    fn served_model(
        &self,
        port: u16,
        timeout: Duration,
    ) -> impl Future<Output = Option<String>> + Send;
}

/// Time as the supervisor sees it: elapsed milliseconds since the clock started, and a pause.
pub trait Clock: Send + Sync + 'static {
    fn elapsed_ms(&self) -> u64;
    fn sleep(&self, duration: Duration) -> impl Future<Output = ()> + Send;
}

/// The real clock, measured from when it was made.
#[derive(Debug)]
pub struct SystemClock {
    started: Instant,
}

impl SystemClock {
    pub fn new() -> Self {
        Self {
            started: Instant::now(),
        }
    }
}

impl Default for SystemClock {
    fn default() -> Self {
        Self::new()
    }
}

impl Clock for SystemClock {
    fn elapsed_ms(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }

    async fn sleep(&self, duration: Duration) {
        tokio::time::sleep(duration).await;
    }
}

/// HTTP/1.0 over a loopback socket, which is enough for llama-server's two endpoints and never chunks its answer.
#[derive(Debug, Default, Clone, Copy)]
pub struct HttpProbe;

/// The status code and body of a loopback GET, or None when nothing answered in time.
async fn get(port: u16, path: &str, timeout: Duration) -> Option<(u16, String)> {
    let exchange = async {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).await.ok()?;
        let request =
            format!("GET {path} HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
        stream.write_all(request.as_bytes()).await.ok()?;
        let mut raw = Vec::new();
        stream.read_to_end(&mut raw).await.ok()?;
        let text = String::from_utf8_lossy(&raw).into_owned();
        let (head, body) = text.split_once("\r\n\r\n").unwrap_or((text.as_str(), ""));
        let status = head.split_whitespace().nth(1)?.parse().ok()?;
        Some((status, body.to_owned()))
    };
    tokio::time::timeout(timeout, exchange).await.ok().flatten()
}

impl HealthProbe for HttpProbe {
    async fn healthy(&self, port: u16, timeout: Duration) -> bool {
        matches!(get(port, "/health", timeout).await, Some((200, _)))
    }

    async fn served_model(&self, port: u16, timeout: Duration) -> Option<String> {
        let (_, body) = get(port, "/v1/models", timeout).await?;
        served_name(&body)
    }
}

/// The model name in a `/v1/models` answer: the first entry's id, model or name, as the reference reads it.
pub fn served_name(body: &str) -> Option<String> {
    let parsed: Value = serde_json::from_str(body).ok()?;
    let entry = parsed
        .get("data")
        .and_then(|data| data.get(0))
        .filter(|entry| !entry.is_null())
        .or_else(|| parsed.get("models").and_then(|models| models.get(0)))?;
    // The reference takes the first of the three that is not null, and reads no name from a value that is not text.
    ["id", "model", "name"]
        .iter()
        .find_map(|key| entry.get(*key).filter(|value| !value.is_null()))
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
}

/// Whether a server's model and the one asked for are the same file, by lowercased name, whatever folder either is in.
pub fn same_model_file(served: &str, model: &str) -> bool {
    let name = |file: &str| basename(&file.replace('\\', "/")).to_lowercase();
    name(served) == name(model)
}

/// Waits until the server on `port` answers its health check, the deadline passes, or `is_alive` says the process is
/// gone. A server answering after ours died is someone else's, so it must not count as ready.
pub async fn wait_for_ready<P: HealthProbe, C: Clock>(
    probe: &P,
    clock: &C,
    port: u16,
    max_wait_ms: u64,
    is_alive: impl Fn() -> bool,
) -> bool {
    let start = clock.elapsed_ms();
    let mut attempt = 0u32;
    while clock.elapsed_ms().saturating_sub(start) < max_wait_ms {
        if !is_alive() {
            return false;
        }
        attempt += 1;
        tracing::debug!(target: "engine.llama", attempt, port, "health check");
        if probe.healthy(port, CHECK_TIMEOUT).await && is_alive() {
            tracing::info!(
                target: "engine.llama",
                port,
                attempts = attempt,
                waited_ms = clock.elapsed_ms().saturating_sub(start),
                "healthy"
            );
            return true;
        }
        clock.sleep(POLL_INTERVAL).await;
    }
    tracing::warn!(
        target: "engine.llama",
        port,
        attempts = attempt,
        waited_ms = clock.elapsed_ms().saturating_sub(start),
        "never became healthy"
    );
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    #[test]
    fn the_served_name_is_the_first_entrys_id() {
        assert_eq!(
            served_name(r#"{"object":"list","data":[{"id":"m.gguf"}]}"#).as_deref(),
            Some("m.gguf")
        );
        assert_eq!(
            served_name(r#"{"models":[{"model":"x.gguf"}]}"#).as_deref(),
            Some("x.gguf")
        );
        assert_eq!(served_name(r#"{"data":[{"id":""}]}"#), None);
        assert_eq!(served_name("not json"), None);
    }

    #[test]
    fn a_model_is_the_same_file_by_name_across_separators_and_case() {
        assert!(same_model_file(
            "C:\\Users\\me\\models\\Ministral-3-8B-Q4_K_M.gguf",
            "models/ministral-3-8b-q4_k_m.gguf"
        ));
        assert!(!same_model_file("Qwen3.6.gguf", "Ministral.gguf"));
    }

    /// A clock that moves only when asked to sleep, so a wait of minutes takes no time.
    struct ManualClock {
        now: AtomicU64,
    }

    impl Clock for ManualClock {
        fn elapsed_ms(&self) -> u64 {
            self.now.load(Ordering::SeqCst)
        }
        async fn sleep(&self, duration: Duration) {
            self.now
                .fetch_add(duration.as_millis() as u64, Ordering::SeqCst);
        }
    }

    /// Answers healthy from its nth check onward, and counts the checks.
    struct CountingProbe {
        healthy_from: u32,
        checks: AtomicU64,
    }

    impl HealthProbe for CountingProbe {
        async fn healthy(&self, _port: u16, _timeout: Duration) -> bool {
            let seen = self.checks.fetch_add(1, Ordering::SeqCst) + 1;
            seen >= u64::from(self.healthy_from)
        }
        async fn served_model(&self, _port: u16, _timeout: Duration) -> Option<String> {
            None
        }
    }

    #[tokio::test]
    async fn the_wait_ends_at_the_first_healthy_answer() {
        let clock = ManualClock {
            now: AtomicU64::new(0),
        };
        let probe = CountingProbe {
            healthy_from: 3,
            checks: AtomicU64::new(0),
        };
        assert!(wait_for_ready(&probe, &clock, 1, 90_000, || true).await);
        assert_eq!(probe.checks.load(Ordering::SeqCst), 3);
        assert_eq!(clock.elapsed_ms(), 1000);
    }

    #[tokio::test]
    async fn the_wait_gives_up_at_the_deadline() {
        let clock = ManualClock {
            now: AtomicU64::new(0),
        };
        let probe = CountingProbe {
            healthy_from: u32::MAX,
            checks: AtomicU64::new(0),
        };
        assert!(!wait_for_ready(&probe, &clock, 1, 30_000, || true).await);
        assert_eq!(probe.checks.load(Ordering::SeqCst), 60);
    }

    #[tokio::test]
    async fn the_wait_stops_as_soon_as_the_process_is_gone() {
        let clock = ManualClock {
            now: AtomicU64::new(0),
        };
        let probe = CountingProbe {
            healthy_from: u32::MAX,
            checks: AtomicU64::new(0),
        };
        assert!(!wait_for_ready(&probe, &clock, 1, 90_000, || false).await);
        assert_eq!(probe.checks.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn a_server_answering_after_ours_died_does_not_count() {
        let clock = ManualClock {
            now: AtomicU64::new(0),
        };
        let probe = CountingProbe {
            healthy_from: 1,
            checks: AtomicU64::new(0),
        };
        let alive = AtomicU64::new(0);
        // Alive for the first check, gone by the time its answer arrives.
        let is_alive = || alive.fetch_add(1, Ordering::SeqCst) == 0;
        assert!(!wait_for_ready(&probe, &clock, 1, 90_000, is_alive).await);
    }
}
