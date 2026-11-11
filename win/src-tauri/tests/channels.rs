//! Keeps electronApi.ts and the Rust registry in step: every channel the renderer calls is either
//! served or listed as pending, and nothing is served that the renderer never calls.

use std::collections::BTreeSet;

use draggy_win::ipc::{Registry, pending::PENDING_CHANNELS};

/// Channel strings passed as the first argument of `ipc.invoke(` or `ipc.send(`.
fn renderer_channels() -> BTreeSet<String> {
    let source = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../src/platform/electronApi.ts"
    ))
    .expect("electronApi.ts is readable");
    let mut found = BTreeSet::new();
    for call in ["ipc.invoke(", "ipc.send("] {
        for part in source.split(call).skip(1) {
            let rest = part.trim_start();
            if let Some(name) = rest.strip_prefix('"').and_then(|r| r.split('"').next()) {
                found.insert(name.to_owned());
            }
        }
    }
    found
}

#[test]
fn every_renderer_channel_is_registered_or_pending() {
    let registered: BTreeSet<_> = Registry::build().channels().into_iter().collect();
    let pending: BTreeSet<_> = PENDING_CHANNELS.iter().copied().collect();
    let missing: Vec<_> = renderer_channels()
        .into_iter()
        .filter(|c| !registered.contains(c.as_str()) && !pending.contains(c.as_str()))
        .collect();
    assert!(
        missing.is_empty(),
        "channels with no handler or pending entry: {missing:?}"
    );
}

#[test]
fn every_registered_channel_exists_in_electron_api() {
    let used = renderer_channels();
    let unknown: Vec<_> = Registry::build()
        .channels()
        .into_iter()
        .filter(|c| !used.contains(*c))
        .collect();
    assert!(
        unknown.is_empty(),
        "registered but never called: {unknown:?}"
    );
}

#[test]
fn a_channel_is_not_both_registered_and_pending() {
    let registered = Registry::build().channels();
    let both: Vec<_> = PENDING_CHANNELS
        .iter()
        .filter(|c| registered.contains(c))
        .collect();
    assert!(both.is_empty(), "registered and still pending: {both:?}");
}
