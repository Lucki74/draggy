# Native apps status

The Windows app is the Electron app in `win/`. The Linux and macOS apps are native and separate. All three share the Rust core in `core/` and the fixtures in `shared/fixtures/`.

## Linux (`linux/`)

Works:

- GTK 4 and libadwaita window with sidebar, header bars and light and dark theme tokens.
- Settings dialog and settings storage.
- API key storage in the Secret Service keyring, with an explicit error when no keyring is running.
- Desktop file, AppStream metadata and icon.

Missing:

- Chat view and message streaming.
- Calls into the core (agent, providers, tools, documents). The crate links `draggy-core` but does not use it yet.
- Model and engine management.
- Documents and web panes.
- Packaging, a signed release and a release workflow.
- Widget tests. Only the display-free library has tests.

Not verified on this branch's author machine (Windows): building and running the app. See `docs/linux.md` for the commands CI runs.

## macOS

Not started.
