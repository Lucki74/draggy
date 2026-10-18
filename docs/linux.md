# Draggy for Linux

The Linux app is a GTK 4 and libadwaita shell over the shared Rust core. It lives in `linux/` and is a standalone crate with its own `Cargo.lock`, so the core workspace never needs GTK. It depends on `core/crates/draggy-core` by path and does not touch `win/`.

## Build and run

You need Rust 1.92 or newer, the GTK 4.14 and libadwaita 1.5 development packages, and `blueprint-compiler` (the build script compiles the `.blp` templates with it).

On Debian or Ubuntu 24.04:

```bash
sudo apt install build-essential pkg-config libgtk-4-dev libadwaita-1-dev blueprint-compiler
```

Then, from the repository root:

```bash
cd linux
cargo run
```

The binary is called `draggy`. Settings are kept per user, and the API key goes to the desktop keyring (GNOME Keyring or KWallet through the Secret Service). With no keyring running the key is refused, never written to a file.

## Tests

```bash
cd linux
cargo test --lib
cargo clippy --all-targets -- -D warnings
```

The library crate holds everything that can be checked without a display: settings, the secret store, the runtime, and the chat logic in `src/chat.rs` (the transcript, how core events change it, and the bridge from a turn's threads to the main loop). The widgets are in the binary. Their few tests build the chat page and the settings dialog, and run under `xvfb-run` in CI and return early when there is no display.

## Chat

Settings name a server address and a model. The first message creates a `draggy_core::Session` from them and the stored key; a change in the settings starts a new conversation. A turn runs on the shell's runtime. Its events, approval questions and result come back over a channel to the main loop, which updates the labels of the reply in place. Replies show as plain text for now.

Each conversation is saved as one JSON file under `$XDG_DATA_HOME/draggy/conversations` (or `~/.local/share/draggy/conversations`) after every turn. The module `src/conversations.rs` holds the store and is pure logic. The newest conversation is shown at launch, and the next message restores it into the session with `Session::restore`. Tool steps and speed are not saved, only the text.

The shared core has its own suite:

```bash
cd core
cargo test --workspace
```

## Packaging

`cargo deb` metadata is in `linux/Cargo.toml`. The desktop file, AppStream metadata and the 512 px icon are in `linux/data/`. No package has been built or published yet.

## Status

See [NATIVE-STATUS.md](../NATIVE-STATUS.md).
