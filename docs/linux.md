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

The library crate holds everything that can be checked without a display (settings, secret store, runtime). The widgets are in the binary and have no automated tests yet.

The shared core has its own suite:

```bash
cd core
cargo test --workspace
```

## Packaging

`cargo deb` metadata is in `linux/Cargo.toml`. The desktop file, AppStream metadata and the 512 px icon are in `linux/data/`. No package has been built or published yet.

## Status

See [NATIVE-STATUS.md](../NATIVE-STATUS.md).
