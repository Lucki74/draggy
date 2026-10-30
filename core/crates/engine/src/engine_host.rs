//! One local inference engine at a time. llama.cpp and colibri each own a process; starting one stops the other, so two
//! models never fight over the same RAM and VRAM. Port of electron/engineHost.cjs.

use std::future::Future;

/// The part of an engine the host drives: stop it now, and say what it is doing.
pub trait EngineControl {
    fn stop_sync(&self);
    fn status(&self) -> EngineStatus;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub model: Option<String>,
}

/// What a launch reported: whether the engine came up, and why not when it did not.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchOutcome {
    pub success: bool,
    pub detail: Option<String>,
}

/// The engine the host reports, with its state. `kind` is None when nothing was ever started.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostStatus {
    pub kind: Option<&'static str>,
    pub running: bool,
    pub port: Option<u16>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum HostError {
    #[error("Unknown engine: {0}")]
    UnknownEngine(String),
    #[error("{0}")]
    Launch(String),
}

/// Holds the llama.cpp and colibri engines and keeps one of them active.
pub struct EngineHost<L: EngineControl, C: EngineControl> {
    llamacpp: L,
    colibri: C,
    active: Option<&'static str>,
}

/// The `mlx` kind exists so the setting can name it; it runs only on Apple silicon, so here it always refuses.
const MLX_UNAVAILABLE: &str = "The MLX engine runs only on Apple silicon Macs.";

/// The engine a model of `format` runs on. GGUF always goes to llama.cpp. MLX goes to the MLX engine on Apple silicon and
/// is refused elsewhere; there is no silent fallback to llama.cpp, which cannot read MLX weights.
pub fn engine_for_format(
    format: &str,
    os: crate::platform::Os,
    arch: crate::platform::Arch,
) -> Result<&'static str, HostError> {
    use crate::platform::{Arch, Os};
    match format {
        "gguf" => Ok("llamacpp"),
        "mlx" if os == Os::MacOs && arch == Arch::Arm64 => Ok("mlx"),
        "mlx" => Err(HostError::Launch(MLX_UNAVAILABLE.to_owned())),
        other => Err(HostError::UnknownEngine(other.to_owned())),
    }
}

fn canonical_kind(kind: &str) -> Option<&'static str> {
    match kind {
        "llamacpp" => Some("llamacpp"),
        "colibri" => Some("colibri"),
        _ => None,
    }
}

impl<L: EngineControl, C: EngineControl> EngineHost<L, C> {
    pub fn new(llamacpp: L, colibri: C) -> Self {
        Self {
            llamacpp,
            colibri,
            active: None,
        }
    }

    /// The engine the host last started, if it is still the one running.
    pub fn active(&self) -> Option<&'static str> {
        self.active
    }

    fn stop_others(&self, kind: &str) {
        if kind != "llamacpp" {
            self.llamacpp.stop_sync();
        }
        if kind != "colibri" {
            self.colibri.stop_sync();
        }
    }

    /// Runs `launch` as the one active engine. When the launch reports failure, nothing is left active. When it errors,
    /// the engine stays marked as the one that was starting, as the reference does.
    pub async fn start<F, Fut>(&mut self, kind: &str, launch: F) -> Result<LaunchOutcome, HostError>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<LaunchOutcome, String>>,
    {
        if kind == "mlx" {
            tracing::warn!(target: "engine.host", "mlx engine is not available on this platform");
            return Err(HostError::Launch(MLX_UNAVAILABLE.to_owned()));
        }
        let Some(canonical) = canonical_kind(kind) else {
            tracing::error!(target: "engine.host", kind, "unknown engine");
            return Err(HostError::UnknownEngine(kind.to_owned()));
        };
        self.stop_others(canonical);
        self.active = Some(canonical);
        let outcome = match launch().await {
            Ok(outcome) => outcome,
            Err(message) => {
                tracing::warn!(target: "engine.host", kind = canonical, "engine failed to start");
                return Err(HostError::Launch(message));
            }
        };
        if !outcome.success && self.active == Some(canonical) {
            self.active = None;
        }
        tracing::info!(target: "engine.host", kind = canonical, success = outcome.success, "engine started");
        Ok(outcome)
    }

    /// Stops both engines, as on quit.
    pub fn stop(&mut self) {
        self.llamacpp.stop_sync();
        self.colibri.stop_sync();
        tracing::debug!(target: "engine.host", "engines stopped");
        self.active = None;
    }

    /// The running engine if any, else the last one started with nothing running.
    pub fn status(&self) -> HostStatus {
        let coli = self.colibri.status();
        if coli.running {
            return HostStatus {
                kind: Some("colibri"),
                running: true,
                port: coli.port,
                model: coli.model,
            };
        }
        let llama = self.llamacpp.status();
        if llama.running {
            return HostStatus {
                kind: Some("llamacpp"),
                running: true,
                port: llama.port,
                model: llama.model,
            };
        }
        HostStatus {
            kind: self.active,
            running: false,
            port: None,
            model: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    #[test]
    fn formats_route_to_engines() {
        use crate::platform::{Arch, Os};
        let cases = [
            ("gguf", Os::Windows, Arch::X64, Ok("llamacpp")),
            ("gguf", Os::Linux, Arch::Arm64, Ok("llamacpp")),
            ("gguf", Os::MacOs, Arch::Arm64, Ok("llamacpp")),
            ("mlx", Os::MacOs, Arch::Arm64, Ok("mlx")),
            ("mlx", Os::MacOs, Arch::X64, Err(MLX_UNAVAILABLE)),
            ("mlx", Os::Windows, Arch::X64, Err(MLX_UNAVAILABLE)),
            ("mlx", Os::Linux, Arch::X64, Err(MLX_UNAVAILABLE)),
        ];
        for (format, os, arch, want) in cases {
            let got = engine_for_format(format, os, arch);
            assert_eq!(
                got,
                want.map_err(|m: &str| HostError::Launch(m.to_owned())),
                "{format} {os:?} {arch:?}"
            );
        }
        assert!(matches!(
            engine_for_format("onnx", Os::Linux, Arch::X64),
            Err(HostError::UnknownEngine(_))
        ));
    }

    /// A stand-in engine that records how often it was stopped and what it reports.
    struct FakeEngine {
        running: RefCell<bool>,
        stops: Cell<u32>,
    }

    impl FakeEngine {
        fn new() -> Self {
            Self {
                running: RefCell::new(false),
                stops: Cell::new(0),
            }
        }
    }

    impl EngineControl for FakeEngine {
        fn stop_sync(&self) {
            self.stops.set(self.stops.get() + 1);
            *self.running.borrow_mut() = false;
        }
        fn status(&self) -> EngineStatus {
            let running = *self.running.borrow();
            EngineStatus {
                running,
                port: running.then_some(1),
                model: running.then(|| "m".to_owned()),
            }
        }
    }

    fn ok() -> LaunchOutcome {
        LaunchOutcome {
            success: true,
            detail: None,
        }
    }

    #[tokio::test]
    async fn starting_one_engine_stops_the_other() {
        let mut host = EngineHost::new(FakeEngine::new(), FakeEngine::new());
        host.start("llamacpp", || async { Ok(ok()) }).await.ok();
        assert_eq!(host.llamacpp.stops.get(), 0);
        host.start("colibri", || async { Ok(ok()) }).await.ok();
        assert_eq!(host.llamacpp.stops.get(), 1);
        assert_eq!(host.active(), Some("colibri"));
    }

    #[tokio::test]
    async fn a_failed_start_leaves_nothing_active() {
        let mut host = EngineHost::new(FakeEngine::new(), FakeEngine::new());
        let outcome = host
            .start("colibri", || async {
                Ok(LaunchOutcome {
                    success: false,
                    detail: Some("colibri-nomem".to_owned()),
                })
            })
            .await;
        assert_eq!(
            outcome.map(|o| o.detail),
            Ok(Some("colibri-nomem".to_owned()))
        );
        assert_eq!(host.active(), None);
        assert!(!host.status().running);
    }

    #[tokio::test]
    async fn a_thrown_start_keeps_the_engine_marked_active() {
        let mut host = EngineHost::new(FakeEngine::new(), FakeEngine::new());
        let result = host
            .start("llamacpp", || async { Err("boom".to_owned()) })
            .await;
        assert_eq!(result, Err(HostError::Launch("boom".to_owned())));
        assert_eq!(host.active(), Some("llamacpp"));
    }

    #[tokio::test]
    async fn the_mlx_kind_refuses_and_leaves_the_running_engine_alone() {
        let mut host = EngineHost::new(FakeEngine::new(), FakeEngine::new());
        host.start("llamacpp", || async { Ok(ok()) }).await.ok();
        let result = host.start("mlx", || async { Ok(ok()) }).await;
        assert_eq!(result, Err(HostError::Launch(MLX_UNAVAILABLE.to_owned())));
        assert_eq!((host.llamacpp.stops.get(), host.colibri.stops.get()), (0, 1));
        assert_eq!(host.active(), Some("llamacpp"));
    }

    #[tokio::test]
    async fn stop_reaches_both_and_an_unknown_engine_is_refused() {
        let mut host = EngineHost::new(FakeEngine::new(), FakeEngine::new());
        host.stop();
        assert_eq!(
            (host.llamacpp.stops.get(), host.colibri.stops.get()),
            (1, 1)
        );
        let result = host.start("vllm", || async { Ok(ok()) }).await;
        assert_eq!(result, Err(HostError::UnknownEngine("vllm".to_owned())));
        assert_eq!(
            result.map_err(|e| e.to_string()).err().as_deref(),
            Some("Unknown engine: vllm")
        );
    }
}
