//! Duration limits, in milliseconds, past which an IPC call is logged as slow. Channels that run long get their own limit.

const DEFAULT_IPC_SLOW_MS: u64 = 2_000;

const IPC_SLOW_MS: [(&str, u64); 22] = [
    ("models:download", 30_000),
    ("gguf:download", 30_000),
    ("gguf:setup-engine", 60_000),
    ("gguf:start", 120_000),
    ("colibri:install", 60_000),
    ("colibri:start", 120_000),
    ("largemodel:download", 30_000),
    ("hardware:benchmark", 120_000),
    ("sd:setup-engine", 60_000),
    ("sd:download-repo", 30_000),
    ("sd:generate", 300_000),
    ("run-code", 60_000),
    ("mcp:call", 120_000),
    ("mcp:start", 60_000),
    ("mcp:start-enabled", 60_000),
    ("updater:download", 120_000),
    ("updater:check", 15_000),
    ("search-web", 15_000),
    ("search-web-detailed", 30_000),
    ("get-page-content", 30_000),
    ("search-models", 15_000),
    ("check-internet", 10_000),
];

/// Object.prototype members. A lookup in the JavaScript table returns one of these for them, not a number.
const PROTOTYPE_KEYS: [&str; 12] = [
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
    "__proto__",
    "constructor",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
    "toString",
    "valueOf",
];

/// The slow limit for an IPC channel, or the default for a channel not in the table.
/// TS quirk: `IPC_SLOW_MS["constructor"]` is a function, and `durMs > fn` is NaN, so such a channel never warns. `u64::MAX` agrees.
pub fn ipc_slow_ms(channel: &str) -> u64 {
    if let Some((_, limit)) = IPC_SLOW_MS.iter().find(|(name, _)| *name == channel) {
        return *limit;
    }
    if PROTOTYPE_KEYS.contains(&channel) {
        return u64::MAX;
    }
    DEFAULT_IPC_SLOW_MS
}

#[cfg(test)]
mod tests {
    use super::ipc_slow_ms;

    #[test]
    fn known_channels_and_the_default() {
        assert_eq!(ipc_slow_ms("models:download"), 30_000);
        assert_eq!(ipc_slow_ms("check-internet"), 10_000);
        assert_eq!(ipc_slow_ms("not-a-channel"), 2_000);
    }

    #[test]
    fn prototype_members_never_warn() {
        assert_eq!(ipc_slow_ms("constructor"), u64::MAX);
        assert_eq!(ipc_slow_ms("__proto__"), u64::MAX);
    }
}
