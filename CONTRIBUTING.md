# Contributing to Draggy

Thanks for looking. Draggy is a small project with a specific point of view, so this file is mostly about what that point of view is.

## Open an issue first for anything large

Bug fixes, translation corrections, and small improvements are welcome as pull requests straight away. For a new feature, a new dependency, or anything that changes how the app behaves on first launch, open an issue first. Draggy says no to a lot of reasonable ideas on purpose, and it is better to find that out before you write the code.

Things Draggy deliberately does not do: phone home, collect analytics, require an account, or send anything anywhere the user did not ask for. Any change weakening those guarantees will be declined.

## Getting it running

You need Node 24 (the version in `win/.nvmrc`, matching CI) and the Rust toolchain for the Tauri shell. Run every command below from `win/`.

```bash
cd win
npm install
```

The app bundles a pinned `node.exe` as a sidecar. `vendor/` is git-ignored, so fetch the version listed in `win/scripts/node-pin.json` into `win/vendor/node/node.exe` before the first run. CI does the same download and checks its SHA-256.

```bash
npm run tauri:dev
```

That stages the sidecar, then starts Vite on port 5173 with hot reload inside the Tauri window.

## Before you open a pull request

```bash
npm run check
```

Typecheck, lint, and run the test suite. CI runs the same command for every pull request, along with the Rust format, clippy and test checks in `win/src-tauri/`. Pull requests are squash merged.

Tests run with no GPU and no Tauri window, so keep new logic testable by keeping it isolated from hardware and from the window shell.

## Architecture and code boundaries

The [documentation](https://docs.draggy.org/development) describes the folder layout and the two boundaries that matter most:

- The Tauri capabilities in `win/src-tauri/capabilities/` and the IPC commands in `win/src-tauri/src/ipc/` are the only bridge from the renderer to the filesystem, network, and database.
- The Content Security Policy in `win/src-tauri/tauri.conf.json` applies to the app's own webview. Never loosen it.

All child processes must start through the hidden-spawn helpers in `core/crates/tools/src/spawn.rs`. Never use `npx` at runtime.

Pictures come from stable-diffusion.cpp's `sd-server`, a hidden child process on `127.0.0.1`, managed by the engine crate in `core/crates/engine/`. Its tests run against a fake server started as a real child process, so they need no binary and no GPU. Keep it that way.

Models too large for memory run on colibri, a second engine managed by the same crate. Its tests also use fakes, so they need no engine, no GPU and no big download. Only one local engine runs at a time (`core/crates/engine/src/engine_host.rs`). The user-facing side is described in the documentation at [docs.draggy.org](https://docs.draggy.org).

## House style

- Match the file you are editing.
- Line endings are CRLF in source files. ESLint is the automated checker for the renderer.
- Avoid new dependencies unless strictly necessary.

## Translations

Draggy supports four languages: English, French, Spanish, and Russian. CI enforces that every language defines exactly the keys English does. Do not use machine translation; each table maintains its own register (`vous` in French, `tú` in Spanish, `вы` in Russian).

## Copyright and licensing

Draggy is licensed under the [Apache License 2.0](LICENSE). By contributing, you agree that your contributions are licensed under Apache 2.0 and will retain the [NOTICE](NOTICE) file that credits Draggy.

## Releases

A build is cut by the maintainer from the Release workflow. See [RELEASING.md](RELEASING.md).
