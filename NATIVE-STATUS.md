# Native apps status

The Windows app is the Electron app in `win/`. The Linux and macOS apps are native and separate. All three share the Rust core in `core/` and the fixtures in `shared/fixtures/`.

## Linux (`linux/`)

Works:

- GTK 4 and libadwaita window with sidebar, header bars and light and dark theme tokens.
- Settings dialog and settings storage.
- API key storage in the Secret Service keyring, with an explicit error when no keyring is running.
- Desktop file, AppStream metadata and icon.
- Chat page: type a message, watch the reply stream in, see the tool steps and the speed, stop a turn, and answer the core's approval questions. It talks to an OpenAI-compatible server that is already running, through `draggy-core`'s `Session`.

Missing:

- Saved conversations. The transcript lives in memory and a settings change starts a new one.
- Markdown, code blocks and attachments in the chat. Messages show as plain text.
- Core calls beyond a chat turn (documents, web, MCP).
- Model and engine management.
- Documents and web panes.
- Packaging, a signed release and a release workflow.
- Widget tests beyond two small ones that run under xvfb. The turn logic is tested without one.

Not verified on this branch's author machine (Windows): building and running the app. See `docs/linux.md` for the commands CI runs.

## macOS (`macos/`)

Works (as written, not yet compiled):

- SwiftUI window with a sidebar and a settings scene.
- API key storage in the Keychain.
- Chat page: type a message and watch the reply stream in through `draggy-core`'s `Session`, with Stop.
- The bindings pipeline: `macos/scripts/build-core.sh` builds the core, generates the Swift bindings and packs an XCFramework.
- The transcript on an `NSTableView` with TextKit 2 text views, with tool steps, tokens per second, and code blocks, inline code and bold drawn.
- A project folder, a permission mode, an option to allow commands, and an approval sheet for the core's questions.
- A macOS CI workflow.

Missing:

- Saved conversations. The core has no call to restore messages yet, so they would show but lose the model's context.
- Full markdown (lists, links, headings) and attachments.
- Model and engine management, documents and web panes.
- Signing, notarization, Sparkle and a release workflow.

Not verified: none of the Swift has been compiled, since the author's machine runs Windows. See `docs/macos.md` for the likely failure points. The first macOS CI run is the first real check.
