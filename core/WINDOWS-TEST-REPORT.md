# Windows test report

Run on Windows 11 with the MSVC Build Tools, Rust stable 1.99.0 and Node 24.22.0, on branch `os-separation`. Nothing from `core/` was loosened or skipped to get a green run. Shared fixture JSON was not edited.

## Core gates

`cargo fmt --all --check`, `cargo clippy --workspace --all-targets --locked -- -D warnings` and `cargo deny check` pass. `cargo test --workspace --locked` gives 871 passed, 0 failed, 17 ignored. The brief expected 892 on Linux. The gap is tests gated to unix (POSIX shell and session tests) and the ignored real-engine tests.

Most failures were real Windows problems in tests or helpers rather than product bugs: hard-coded `/` separators, a Unix mode bit in a git hook test, Unix-only disk space and supervisor helpers, and two log capture tests that raced under parallel runs.

## Engine run

llama.cpp for Windows and a small GGUF were downloaded into a temp folder outside the repo. The server loaded the model and listened. On the first inference request the security software removed `llama-server.exe`, so the tool-using chat, the refused read outside the folder and the mid-stream cancel could not be run. Changing the antivirus settings is outside what I may do, so these three are not testable here.

## Electron

`npm ci` and `npm run electron:build` pass, and `dist-electron/draggy_setup.exe` and `win-unpacked/Draggy.exe` are produced. The window cannot be driven from this session, so the manual items are not testable: engine download, chat, Code mode tool approval, browser pane, MCP connection, docx and xlsx export, Talk.

`npm run check` has 129 failing vitest fixture cases on Windows, all in the TS fixture runners that compare paths and shell output with POSIX expectations. They are reported and not changed, since the fixtures are shared with the Rust side. One documents-office case depends on the local timezone.

## Results

| What ran | Result | Fix commit |
| --- | --- | --- |
| Git hook test without a Unix mode bit | pass | 22bc8f2 Run the git hook test on Windows without a Unix mode bit |
| MCP server `stop_all` | pass | d062b14 Take the live servers with mem::take on stop_all |
| Free disk space on Windows | pass | 2e4b324 Read free disk space with fs4 on Windows |
| Hardware probe volume ids | pass | 8d9a4a1 Decode UTF-16 volume ids with as_chunks |
| Supervisor test helpers | pass | f33ff7a Gate the POSIX supervisor test helpers so Windows builds clean |
| POSIX shell and session tests | gated to unix | 7d5e7ca Gate POSIX shell and session tests to unix |
| Provider installer tests | pass | 70e64cd Make provider installer tests separator-neutral |
| Provider fixture runner | pass | 74ae6ee Read path separators neutrally in provider fixture runner |
| Model cache paths | pass | c16b1ff Compare cached model paths without a drive or separators |
| Engine fixtures and flows | pass | e3f51f2 Make engine fixture and flow path checks separator-neutral |
| API log capture test | pass | 60a49b5 Keep the API log capture test stable under parallel tests |
| Storage log capture test | pass | ce3eed5 Keep the storage log capture test stable under parallel tests |
| Real engine chat, refusal, cancel | not testable, binary removed by antivirus | none |
| Electron build and installer artifacts | pass | none |
| Electron manual pass | not testable from this session | none |
| TS fixture runners on Windows | 129 failing, not fixed | none |
