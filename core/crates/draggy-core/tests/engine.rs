use draggy_core::{CoreError, EngineHost, LocalEngine};

fn engine() -> LocalEngine {
    LocalEngine::new(EngineHost {
        total_ram_bytes: 16 * 1024 * 1024 * 1024,
        gpu_memory_gb: 0.0,
    })
}

#[test]
fn a_new_engine_is_not_running() {
    let state = engine().state();
    assert!(!state.running);
    assert!(state.model.is_none());
}

#[tokio::test]
async fn starting_without_a_model_is_refused() {
    let result = engine()
        .start("llama-server".into(), "  ".into(), None, 0.0, None)
        .await;
    assert!(matches!(result, Err(CoreError::Invalid { .. })));
}

#[tokio::test]
async fn a_missing_program_is_an_engine_error() {
    let dir = tempfile::tempdir().unwrap();
    let model = dir.path().join("m.gguf");
    std::fs::write(&model, b"x").unwrap();
    let missing = dir.path().join("no-such-llama-server");
    let result = engine()
        .start(
            missing.to_string_lossy().into_owned(),
            model.to_string_lossy().into_owned(),
            None,
            0.0,
            None,
        )
        .await;
    assert!(
        matches!(result, Err(CoreError::Engine { .. })),
        "{result:?}"
    );
}
