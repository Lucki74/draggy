//! Channels electronApi.ts calls that have no Rust handler yet. A later step moves each one into the
//! registry and out of this list; tests/channels.rs fails when the two drift.

pub const PENDING_CHANNELS: &[&str] = &[
    "browser-agent:release",
    "browser-agent:stop",
    "browser-bar-action",
    "browser-bar-menu",
    "browser-bar-set-adblock",
    "browser-click",
    "browser-consent:answer",
    "browser-dialog",
    "browser-drag",
    "browser-get-elements",
    "browser-get-text",
    "browser-grants:list",
    "browser-grants:revoke",
    "browser-hover",
    "browser-press-key",
    "browser-screenshot",
    "browser-scroll",
    "browser-select-option",
    "browser-snapshot",
    "browser-trace",
    "browser-type",
    "browser-wait",
    "updater:install",
    "updater:state",
];
