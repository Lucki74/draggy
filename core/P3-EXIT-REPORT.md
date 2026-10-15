# P3 exit report

Branch `os-separation`. P3 is done as far as a Linux container allows. The exit criteria have two halves, and only one of them could be met here.

## Met

- Every area in the plan has a Rust port with golden fixtures in `shared/fixtures/`: storage, diagnostics, agent parsing and prompts, models, tools, web, engine, providers, the agent loop and state, MCP, documents, the local API server and secrets.
- The fixtures run in both runners. The expected values come from the TypeScript reference, and vitest and cargo read the same JSON. `npm run check` passes with 296 test files and 9,759 tests. `cargo test --workspace` passes 892 tests, and `cargo fmt`, `cargo clippy -D warnings` and `cargo deny check` are clean.
- The UniFFI boundary exists in `crates/draggy-core`. It follows the rules in the plan: a callback `TurnObserver` batched at one frame, an async `Session::send` that runs the turn off the caller's thread, flat records, an explicit `CancelToken`, and opaque `Session` and `CancelToken` handles. Swift bindings generate from the compiled library, and CI has a job that does it on every change.
- `core/examples/chat.rs` runs a tool-using chat through the same code the shells will call. The session tests run it against a scripted OpenAI-compatible server on loopback: streaming, a tool call that reads a file, a read outside the folder that is refused, cancelling mid-stream and a server error.
- Security fixes found along the way went into the Electron code and the Rust port together, and the fixtures pin them: dangling links in the file guard, skill file reads, NFKC in denied names, private-host gaps in the URL policy, redirect hops on page reads and new windows from hidden windows.

## Not met

- The harness attaches to a server that is already running. Starting and stopping `llama-server` from the facade means wiring `draggy-engine` into `Session`, which is not done. The engine crate itself is ported and tested.
- Tools wired into `Session` are `read_file`, `list_directory` and, when the config allows it, `run_command`. A command goes through the permission engine, asks the shell through the `ApprovalHandler` callback, and stops when the turn is cancelled. File edits, web search, documents, MCP and skills are ported in their crates but not exposed through the facade yet.
- The facade does not expose storage, the model catalogue or downloads, and the providers other than the OpenAI-compatible one.
- Windows was not built here. `core.yml` builds and tests on `windows-2025` and `macos-15`, so the first CI run is the real check.

## Review

The real-server run is waived by the owner: the scripted loopback server stands in for `llama-server`.

Every area had an independent read-only pass after its port. The last round covered providers, the agent loop, MCP, documents and secrets. The real defects are fixed and tested, and the rest are listed in `PORTING-NOTES.md` under "Review round after wave 2", most of them because the Electron code has the same gap and the shared fixtures pin it.

## Decisions taken

- Collation: the models crate now uses the same ICU root collator as the tools crate. Passing the app locale into the core stays a later step, as the notes say.
- File listings keep showing the names of files under denied folders such as `credentials.d/`. Contents are refused.
- `run()` in the tools crate keeps waiting for pipes a surviving grandchild holds after a timeout, as the reference does. Bounding the wait is a behaviour change for later.
- The recommendation code stays in `models`. The plan text now says so.

## Held

P1 (move to `win/`) and P2 (strip macOS and Linux code) are not started. They wait for the release handoff: merge P0 to main, run the Release workflow, tag `electron-crossplatform-final` and confirm. P4 and P5 need a Mac and Xcode. P6 needs the GTK4, libadwaita and WebKitGTK development packages.
