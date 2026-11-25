# Agent instructions

Notes for AI coding agents working in this repository.

Read [CONTRIBUTING.md](CONTRIBUTING.md) as well. Its house style rules apply unchanged. This file covers what an agent needs on top of that: the commands, invariants enforced by tests, and traps that have cost time here.

## Repository layout

One repository, one shipping app and a shared core:

| Folder | What | Check |
| --- | --- | --- |
| `app/` | The Draggy app for Windows, macOS and Linux: Tauri 2 shell in Rust (`app/src-tauri/`, crate `draggy-win`) and React renderer (`app/src/`, TypeScript). The TypeScript agent loop runs in a pinned `node` sidecar | `npm run check` from `app/`, and the Rust checks in `app/src-tauri/` |
| `core/` | Shared Rust workspace (engine, providers, tools, documents, MCP, storage). The Windows shell uses these crates too | `cargo test` in `core/` |
| `shared/fixtures/` | Golden fixtures read by both vitest and cargo | both suites |

Every path below that starts with `src/`, `src-tauri/` or `scripts/` is relative to `app/`.

Platform code in `app/src-tauri/` comes in `#[cfg(windows)]` and `#[cfg(not(windows))]` pairs, or `target_os = "macos"` where only the Mac differs, and a non-Windows branch leaves Windows behaviour unchanged. The Linux and macOS jobs in `ci.yml` run clippy and the Rust tests on the non-Windows side, so dead code there fails CI. A fixture change must keep the TypeScript and Rust sides passing.

## What Draggy is

A local-first desktop assistant running an embedded native GGUF engine (`llama-server`) with open models from Hugging Face. Mixture-of-Experts models too big for memory run on a second engine, colibri. Pictures come from stable-diffusion.cpp's `sd-server` or from a cloud image model the user picked. No account, no telemetry, and nothing leaves the machine without explicit user action, with the standing exceptions described under Network below. Any change weakening those guarantees is unacceptable.

The Windows app is a Tauri 2 application. The Rust shell is in `app/src-tauri/` (`src/main.rs` is the entry point, `src/lib.rs` sets up the app). The React renderer is in `app/src/`. The TypeScript agent loop runs in the `node.exe` sidecar that ships as `binaries/node`.

## Commands

Run every command below from `app/`.

```bash
npm run check
```

Typecheck, lint, and run the test suite (`tsc -b`, `eslint .`, `vitest run`). Run it before concluding work. CI runs the same check on Node 24, the version in `app/.nvmrc`. CI also runs `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test -q` in `app/src-tauri/`, on Windows, Linux and macOS.

```bash
npm run tauri:dev
```

Runs `tauri dev`. It stages the node.exe sidecar, then starts Vite on port 5173 with hot reload inside the Tauri window. Terminate any stale Vite process holding the port before retrying.

```bash
npm run tauri:build
```

On Windows, stages the sidecar and builds the NSIS installer with `src-tauri/tauri.release.conf.json`, which turns on updater artifacts. The installer lands in `src-tauri/target/release/bundle/nsis/`. The script calls PowerShell, so on macOS and Linux build with `npx tauri build` instead (see below).

```bash
npm run stage:sidecars
```

Copies `vendor/node/node.exe` into `src-tauri/binaries/` under the target-triple name Tauri expects. It fails when the file does not match the pin in `scripts/node-pin.json`. `vendor/` is git-ignored, so a fresh clone must fetch the pinned `node.exe` first; CI does this with the SHA-256 check in `ci.yml`. The app never downloads node at runtime.

It also copies `vendor/ffmpeg/ffmpeg.exe` and `vendor/ffmpeg/ffprobe.exe`, checked against `scripts/ffmpeg-pin.json`, as the `binaries/ffmpeg` and `binaries/ffprobe` sidecars that index attached videos. For dev, copy them from a local ffmpeg install and update the pin; CI fetches the pinned archive. The app never downloads ffmpeg at runtime, and a debug build falls back to `ffmpeg` on `PATH`.

### macOS

The same app ships for macOS as one universal build for Intel and Apple silicon (`npx tauri build --target universal-apple-darwin`), zipped, signed ad hoc and not notarized. For development, Put the `bin/node` from the archive named in `scripts/node-pin-macos.json` at `vendor/node/node`, then:

```bash
npm ci
APPDATA=/tmp/draggy-dev npx tauri dev
npx tauri build --debug
```

Tauri merges `src-tauri/tauri.macos.conf.json` over `tauri.conf.json` on macOS. It builds an `.app`, drops the sandbox launcher and the NSIS settings, points the updater at the macOS feed, and stages sidecars with `scripts/stage-sidecars-mac.sh`. ffmpeg has no macOS pin yet, so that script stages `vendor/ffmpeg/` or the `ffmpeg` on `PATH`, and only in debug builds.

Without `APPDATA` the data folder is `~/Library/Application Support/Draggy`, the usual macOS data folder. Set `APPDATA` to keep a dev run away from it; the data then goes to `$APPDATA/Draggy`. `APPDATA` does not move the webview's storage: WKWebView keeps it in `~/Library/WebKit/<bundle id>`, or `~/Library/WebKit/draggy-win` under `tauri dev`. The bundle id is `com.draggy.app`, the same as the retired Swift app's, so do not open a built `.app` on a Mac that still has the Swift app's data.

### Linux

The same app ships for x86_64 Linux as a `.deb`, an `.rpm` and an AppImage. For development, Install the Tauri system libraries (`libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev` on Ubuntu), put the `bin/node` from the archive named in `scripts/node-pin-linux.json` at `vendor/node/node`, then run the same `npm ci`, `npx tauri dev` and `npx tauri build --debug` as on macOS.

Tauri merges `src-tauri/tauri.linux.conf.json` over `tauri.conf.json` on Linux. It builds the Linux packages, drops the sandbox launcher and the NSIS settings, points the updater at the Linux feed, and stages sidecars with `scripts/stage-sidecars-linux.sh`, which handles ffmpeg the same way as the macOS script.

Without `APPDATA` the data folder is `$XDG_DATA_HOME/Draggy`, or `~/.local/share/Draggy`.

## Two kinds of tests

The parent workspace directory `../temp` (at the root of `draggy`) is reserved for running tests with cargo and scratch test outputs. Keep it clean after tests.

Most tests are pure logic running in Node. Component tests use a `// @vitest-environment jsdom` docblock, render via `@testing-library/react`, and mock the bridge through `src/__tests__/helpers/draggyApi.ts`. Use component tests whenever verifying wiring or lifecycle interactions.

Mocked event subscriptions must return a cleanup function. Returning a promise or boolean causes React to throw `destroy is not a function`.

Rust tests run in `app/src-tauri/tests/` and in the crates under `core/crates/`. `app/sandbox/` is a separate crate with its own `cargo test`.

## Security boundaries

The IPC commands the renderer can call live in `app/src-tauri/src/ipc/`. The permissions granted to each webview are listed in `app/src-tauri/capabilities/main.json` and `capabilities/browser-pane.json`. Adding a command or a permission requires deliberate review, and `app/src-tauri/tests/capabilities.rs` checks the capability files.

The renderer runs under the CSP in `app/src-tauri/tauri.conf.json` (`app.security.csp`). `devCsp` applies only to `tauri dev`. Never loosen the production policy. The same file sets the COOP `same-origin` and COEP `credentialless` headers that let ONNX Runtime use threads.

The browser pane has its own capability file, so its permissions stay separate from the main window's.

Agent commands on Windows run through the sandbox launcher in `app/sandbox/`, an AppContainer that sees the project folder and the toolchains on PATH. Node tools (npm, npx, vitest and the like, listed in `needsHost` in `src/agent/commandRules.ts`) hang in it, because Windows refuses the pipes libuv names, so the agent loop turns them into an outside-the-sandbox request the user approves. The one admin step that opens folders such as `C:\Users` to listing is asked once per machine, recorded in `admin-asked.txt` next to the grant specs.

## Architectural invariants enforced by tests

Every child process must be started through the hidden-spawn helpers in `core/crates/tools/src/spawn.rs` (`spawn_hidden`, `hidden_command`). A GUI build has no console, so a bare process spawn can flash a console window. `core/crates/tools/tests/spawn_guard.rs` fails when any other file names the process APIs. Never launch npm packages through `npx` at runtime.

Outbound HTTP requests on behalf of models must pass through the URL policy in `core/crates/web/src/policy.rs`. Only `http:` and `https:` schemes are permitted, and private network addresses are blocked.

A cloud or hosted model request is routed through the `draggy-ai` protocol handled in `app/src-tauri/src/chat_gateway.rs`. Provider API keys stay in the OS keystore (`app/src-tauri/src/secrets.rs`) and are never returned to the renderer or written to logs. Cloud image and voice requests are the exception to the gateway: `app/src-tauri/src/images/cloud/` and `app/src-tauri/src/tts/cloud/` send them from the Rust process to the provider the user picked, with the key from the keystore, and hand the renderer only picture bytes or PCM frames.

Four languages remain in parity: English (`en`), French (`fr`), Spanish (`es`), and Russian (`ru`). `src/__tests__/translations.test.ts` enforces identical key sets across all four. Do not use machine translation; each table maintains its own register.

### Network

Packaged builds check for updates at launch and every six hours after that (`app/src-tauri/src/ipc/updater.rs`). The launch check runs in the startup splash (`app/src-tauri/src/splash.rs`, page `app/splash.html`): it waits at most 3 seconds for an answer, downloads and installs a found update with a progress line and restarts, and its skip button hands the download to the background updater. The splash opens the main window once the update step is done and closes when the renderer signals `splash:main-ready`, or after 15 seconds. Debug builds play a fake run with `DRAGGY_SPLASH_MOCK=update|error|offline|updated`. The check is always on and has no setting. All three systems use the Tauri updater plugin. Each reads its own signed feed from the latest release. Failures are logged and never block launch. Debug builds do not check.

The cost display keeps its rate card current through `app/src-tauri/src/pricing/`. It sends GET requests only, to the fixed URLs defined there (the LiteLLM price list on raw.githubusercontent.com, the OpenRouter model list, and api.frankfurter.dev for exchange rates), with no body, no cookies and nothing taken from a chat. A failed or implausible download never replaces the bundled snapshot at `shared/pricing/prices.json`. Do not add hosts, methods or payloads to this path, and do not reuse it for anything else. The user can switch the refresh off in Settings.

The ad-block lists are fetched from raw.githubusercontent.com in the background (`app/src-tauri/src/browser/adblock.rs`), whether or not blocking is on. Treat that host list as part of the network policy.

Diagnostics protect privacy through dual-file logging and hashing. Operational logs write to `app.log`, while verbose traces write to `debug.log`. Sensitive text payloads are SHA-256 hashed and truncated before disk write. Stream chunks are recorded by token length only (`core/crates/diagnostics`).

Logging rules: the renderer uses `logSwallow` instead of a silent `catch` (`src/__tests__/silentCatches.test.ts`), and `src/__tests__/logger.test.ts` covers the logger. Keys, OAuth codes and tokens never reach disk in any form, and prompts, replies and file contents appear only as hashes or lengths. To follow one chat turn, run `npm run logs:turn <cid>`.

Single instance enforcement: `app/src-tauri/src/lib.rs` registers the single-instance plugin, so a second launch does not start a second app.

One local engine runs at a time. In the Rust core, `core/crates/engine/src/engine_host.rs` routes a model format to its engine (`engine_for_format`) and hands the slot between llama.cpp and colibri. An MLX model never falls back to llama.cpp, and MLX is Apple silicon only. The runner table is pinned by `shared/fixtures/runner-table.json`; an AMD card takes the ROCm build whenever one is published, and no setting turns that off.

Everything the app downloads and later runs is checked against a SHA-256 first: the colibri archives against the release's `SHA256SUMS.txt`, the image engine archives against hashes pinned in `core/crates/engine/src/sd_runner.rs`, and large-model files against the Hugging Face manifest.

Large-model planning, speed history and diagnostics stay free of prompts and replies. They hold hardware, plans, speeds and counts only. Keep new hardware and disk probes parseable from saved output, so they can be tested from fixtures.

Engine updates occur out of band. `core/crates/engine/src/engine_updater.rs` stages llama.cpp builds and swaps them in on the next launch. If model loading crashes, it rolls back automatically.

Token repetition detection: runaway loops and repetitive refusal tails are halted in real time by `src/agent/repetition.ts` (`src/__tests__/repetition.test.ts`).

First-run onboarding: `src/onboarding/` requires user confirmation before it starts any engine or model download (`src/__tests__/onboarding.test.tsx`). Existing settings, models or chats adopt the install without re-prompting.

Logical layout classes: interface styles use logical CSS properties (`ms-`, `ps-`, `start-`, `text-start`, `border-s`) rather than physical left/right classes, enforced by `src/__tests__/rtl.test.tsx`.

Reasoning models must provide answers after tool calls: `agentLoop` prompts for a final answer if internal reasoning finishes silently after tool runs (`src/__tests__/agentLoop.test.ts`).

Next-step announcements are not replies: if a model finishes a turn only announcing intent, `src/agent/announcement.ts` prompts the model to execute the action.

Immediate turn cancellation: aborting via Escape or the Stop button halts running tool tasks and stops subsequent engine requests (`src/__tests__/agentLoop.test.ts`).

Provider isolation: remote provider models (`@instance/model`) bypass local engine allocation. Provider state attaches only to outgoing requests for that provider (`src/__tests__/providers.test.ts`).

Compact system prompts: `buildSystemPrompt` defaults to the `compact` profile for local engines, pinned by snapshots in `src/__tests__/promptProfile.test.ts`.

### Compatibility with the Electron build

Old Electron installs still exist, so a few formats and feeds must stay as they are. Do not change them without a migration plan.

- The database: the storage schema in `core/crates/storage/src/schema.rs` is additive, so the last Electron release can still open a database the Tauri build wrote. `app/src-tauri/tests/rollback.rs` opens a v1.2.7 fixture to check this.
- Secrets: `app/src-tauri/src/secrets.rs` reads and writes Electron's `secrets.bin` in the same `v10` AES-GCM layout and key location, so saved keys survive the move.
- Updates: the release job also writes a bridge `latest.yml` into the `b-N` release, which Electron installs read. See [RELEASING.md](RELEASING.md).

## House style

Match the surrounding file style. Specific constraints:

- Comments explain why, never what. Maximum two lines per comment, twenty-five words per line maximum, including JSDoc headers.
- Every comment is two lines long at most, without exception.
- Line endings are CRLF in source files.
- Avoid new dependencies unless strictly necessary.
- Keep core logic isolated from hardware APIs to enable headless Node testing.

## Verification

Evidence is required before concluding work:
- Guard tests must be verified against injected regressions to ensure they fail when broken.
- Measure behavior from packaged or GUI processes when testing window or process visibility.
- Note any environment-specific limitations (such as update checks being disabled in debug builds).

## Issues and pull requests

When the owner sends a GitHub issue, first restate roughly what they asked. Then fix it, test that the fix works and that nothing else broke, open a PR, and merge it once the tests pass. Never merge a fix you have not tested.

Every PR description names the issue it closes (`Fixes #N`) and explains the change in two sentences at most, written with the `/humanizer` skill. Commits keep a subject only.

## Releases

Releases are cut from the Release workflow (`release.yml`, run by hand on `main`). The workflow picks the next build number from the `b-N` tags and builds the app as `3.0.N`. Do not tag or publish a release unless asked. Detailed instructions are in [RELEASING.md](RELEASING.md).

## Documentation and website

The public website lives in `websites/www` and the documentation in `websites/docs`, each with its own AGENTS.md. Vercel builds each one from its folder. Draggy interfaces use Phosphor icons (`@phosphor-icons/core`), while the website maintains its own icon builds.

Documentation screenshots come from `npm run shots` (the docs screenshots) and `npm run clips` (the website clips). They start a dev build of the app with WebView2 remote debugging on 127.0.0.1, attach through `scripts/tauri-app.cjs` and run on a throwaway data folder. Screenshots go to `websites/docs/assets/img` and clips to `websites/www/assets/clips` (Git LFS).

- Set `TEMP` and `TMP` to a neutral folder such as `C:\demo` first, so settings screenshots do not show your user name.
- Look at every generation-dependent shot before publishing it.
- Each build's release notes replace the previous ones: keep only the notes file for the current build, `RELEASE-NOTES-BUILD-X.md` during preparation and `RELEASE-NOTES-BUILD-<n>.md` once the build number is set.

## Environment notes

- Bash heredocs can consume backslash escape characters; write Python or Node helper scripts when authoring complex strings.
- PowerShell collections evaluate empty arrays to `$null`. Use hashtables when comparing sets.
- Node 25 includes a native `localStorage` global that conflicts with jsdom; `src/__tests__/helpers/setup.ts` isolates it.
- Cargo lives in `~/.cargo/bin`. Add it to `PATH` in Git Bash before running Rust commands.
- An installed copy of Draggy and a dev build can share data folders and the single-instance lock. Close the installed copy before a dev launch.
