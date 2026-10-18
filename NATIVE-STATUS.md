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
- The transcript on an `NSTableView` with TextKit 2 text views, with tool steps, tokens per second, and code blocks, inline code and bold drawn, headings, bullet lists and http or https links.
- The transcript shows the model's reasoning under a "Thinking" line, and each tool step with its full content, stdout and stderr in monospace. Not yet run on a Mac: only CI compiles it.
- A project folder, a permission mode, an option to allow commands, and an approval sheet for the core's questions.
- Every conversation is saved to its own file in `~/Library/Application Support/Draggy/Conversations` after each turn. The sidebar lists them under History, newest first, and a right-click deletes one. Tool steps are saved with each reply. The window shows the latest at launch, and the core gets a conversation back through `Session.restore` when the next message is sent. The single file older builds wrote is moved in as one conversation.
- A paperclip button in the composer that adds the text of a Word, PowerPoint, Excel or PDF file to the message, read by the core's `read_document`.
- A Servers tab in settings that lists the MCP server catalogue with search, cautions and documentation links.
- Interface text in English, French, Spanish and Chinese through a string catalog. A test checks that every key has all three translations and the same format placeholders. Text that comes from the core, such as tool step names, stays in English.
- A Browser page with a WebKit view, an address bar and back, forward and reload. It keeps its cookies in a store separate from the app. Addresses pass the core's URL policy: only http and https load, and local servers are open to the user.
- VoiceOver support in the chat: each message reads as one row with who spoke and what was said, and the attach button has a label. Nothing in the app animates yet, so Reduce Motion has nothing to change. Other pages rely on SwiftUI's default labels and have not been checked with VoiceOver.
- A macOS CI workflow.

Missing:

- Numbered lists, tables, italics and quotes in markdown, and image attachments.
- Turning MCP servers on. The Servers tab only browses, and the agent cannot call their tools yet.
- Ad blocking and download prompts in the Browser page, and HTML previews of model output. Writing documents (reading them is built).
- Signing, notarization, Sparkle and a release workflow.

Not verified: none of the Swift has been compiled, since the author's machine runs Windows. See `docs/macos.md` for the likely failure points. The first macOS CI run is the first real check.
