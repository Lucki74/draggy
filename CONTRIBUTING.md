# Contributing to Draggy

Draggy is a small project and I have pretty strong opinions about where it goes, so most of this file is about that.

## Open an issue first for big stuff

Bug fixes, translation fixes and small improvements can go straight to a pull request. For a new feature, a new dependency, or anything that changes what happens on first launch, open an issue first. I say no to a lot of reasonable ideas on purpose, and it's better to find that out before you write the code.

Draggy doesn't phone home, collect analytics, ask for an account or send anything anywhere the user didn't ask for. I'll decline any change that weakens that.

## Getting it running

You need Node 24 (the version in `win/.nvmrc`, same as CI) and the Rust toolchain for the Tauri shell. Run everything below from `win/`.

```bash
cd win
npm install
```

The app ships a pinned `node.exe` as a sidecar. `vendor/` is git-ignored, so before the first run, grab the version listed in `win/scripts/node-pin.json` and put it at `win/vendor/node/node.exe`. CI downloads the same file and checks its SHA-256.

```bash
npm run tauri:dev
```

That stages the sidecar, then starts Vite on port 5173 with hot reload inside the Tauri window.

## Before you open a pull request

```bash
npm run check
```

That runs the typecheck, the linter and the tests. CI runs the same command on every pull request, plus the Rust format, clippy and test checks in `win/src-tauri/`. Pull requests get squash merged.

Tests run without a GPU and without a Tauri window, so keep new logic away from the hardware and the window shell, that way it stays testable.

## Architecture and boundaries

The folder layout is in the [docs](https://docs.draggy.org/development). Two boundaries matter more than the rest:

- The Tauri capabilities in `win/src-tauri/capabilities/` and the IPC commands in `win/src-tauri/src/ipc/` are the only way the renderer reaches the filesystem, the network and the database.
- The Content Security Policy in `win/src-tauri/tauri.conf.json` covers the app's own webview. Never loosen it.

Every child process has to start through the hidden-spawn helpers in `core/crates/tools/src/spawn.rs`. Never use `npx` at runtime.

Pictures come either from a cloud provider the user picked or from stable-diffusion.cpp's `sd-server`, a hidden child process on `127.0.0.1` that the engine crate in `core/crates/engine/` manages. Its tests run against a fake server started as a real child process, so they need no binary and no GPU. Please keep it that way.

Models too big for memory run on colibri, a second engine managed by the same crate. Its tests use fakes too, so no engine, no GPU and no huge download. Only one local engine runs at a time (`core/crates/engine/src/engine_host.rs`). The user side of all this is on [docs.draggy.org](https://docs.draggy.org).

## Style

- Match the file you're editing.
- Source files use CRLF line endings. ESLint checks the renderer.
- Don't add a dependency unless you really need it.

## Translations

Draggy is in English, French, Spanish and Russian. CI checks that every language has exactly the keys English has. No machine translation please, and each language keeps its own register (`vous` in French, `tú` in Spanish, `вы` in Russian).

## License

Draggy uses the [Apache License 2.0](LICENSE). By contributing, you agree your code is under Apache 2.0 too, and that the [NOTICE](NOTICE) file crediting Draggy stays.

## Releases

I cut builds from the Release workflow. How that works is in [RELEASING.md](RELEASING.md).
