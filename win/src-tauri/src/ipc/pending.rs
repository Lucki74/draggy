//! Channels electronApi.ts calls that have no Rust handler yet. A later step moves each one into the
//! registry and out of this list; tests/channels.rs fails when the two drift.

pub const PENDING_CHANNELS: &[&str] = &[];
