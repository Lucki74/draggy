---
title: "Building and architecture"
description: "Running from source, the layout of the code, and the two boundaries."
section: reference
---

## Running from source

```bash
cd win
npm install
npm run tauri:dev
```

`tauri dev` stages the `node.exe` sidecar, then starts Vite on port 5173 with hot reload inside the Tauri window. If a stale Vite process holds the port, the next launch fails, so stop it first.

```bash
npm run check
```

Typecheck, lint and the tests (`tsc -b`, `eslint .`, `vitest run`). CI runs the same command, plus `cargo fmt --check`, `cargo clippy` and `cargo test` in `win/src-tauri/`. `npm run tauri:build` stages the sidecar and writes the NSIS installer into `src-tauri/target/release/bundle/nsis/`.

## How it is laid out

| Folder | Holds |
| --- | --- |
| `core/` | Shared Rust workspace: engine, providers, tools, documents, MCP and storage |
| `win/` | Windows Tauri 2 app: `src-tauri/` for the Rust shell and `src/` for the React frontend |
| `macos/` | Native macOS SwiftUI application |
| `linux/` | Native Linux GTK 4 and libadwaita application |
| `shared/` | Shared fixtures, pricing data and app icons |

## The two boundaries

The first is the Tauri capability files. `win/src-tauri/capabilities/main.json` lists what the main window may call, and `browser-pane.json` grants the browser pane nothing. The renderer reaches the filesystem, network and database only through the commands in `win/src-tauri/src/ipc/`. Adding a command or a permission is a deliberate act, and `win/src-tauri/tests/capabilities.rs` checks the files.

The second is the Content Security Policy in `win/src-tauri/tauri.conf.json` (`app.security.csp`). It applies to Draggy's own window. `devCsp` applies only under `tauri dev`. Pages the browser pane opens are not under this policy, so they are kept apart from the main window.

## Logging and diagnostics

Draggy keeps two rotating logs in the application data folder (`logs/`):

- **`app.log`**: Lifecycle events, model management and errors. Prompts and replies are reduced to hashes and lengths, and secrets are scrubbed.
- **`debug.log`**: A more detailed trace. Streaming output is recorded by length, not by text.

Logs rotate at 5 MiB and keep three archives. To see them, open `Settings → Diagnostics → Open log folder`, or set `LOG_LEVEL=DEBUG` or `DEBUG_LOG_LEVEL=DEBUG` for the most detail. For a bug report, use `Settings → Diagnostics → Export diagnostics`.

## Inference engine

Draggy runs local models with an embedded engine:

- **GGUF (llama.cpp)**: Runs `.gguf` model files in a hidden `llama-server` child process on port `11435`. On Windows, the CUDA build is chosen when a graphics card with memory is found, and Vulkan otherwise. AMD cards use the ROCm build ahead of Vulkan when one is published. Only one local engine runs at a time.

[CONTRIBUTING.md](https://github.com/Lucki74/draggy/blob/main/CONTRIBUTING.md) has the rest, and [SECURITY.md](https://github.com/Lucki74/draggy/blob/main/SECURITY.md) covers reporting a vulnerability.

The website and this documentation live in the app repository, under [websites/www](https://github.com/Lucki74/draggy/tree/main/websites/www) and [websites/docs](https://github.com/Lucki74/draggy/tree/main/websites/docs).
