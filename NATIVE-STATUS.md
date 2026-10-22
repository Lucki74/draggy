# Native apps status

The Windows app is the Electron app in `win/`. The Linux and macOS apps are native and separate. All three share the Rust core in `core/` and the fixtures in `shared/fixtures/`.

Build 5 removed the Gemini CLI account route from the Windows app, because Google stopped serving it to personal Pro, Ultra and free accounts on 18 June 2026. The Rust core and the shared fixtures dropped it too, and the `google` catalog entry now names the Antigravity (`agy`) protocol. The core now holds the pure logic of the `agy` adapter (`core/crates/providers/src/agy/`: prompt, arguments, event stream, failures). The core also hosts the CLI (`agy_host.rs`): it runs one process per turn, refuses any session that is not in review mode, and gates sign-in behind the terms warning. Linux has a Google page and macOS a Google section in Settings that use it. Chat through Antigravity is text only, and the app's own file, web and server tools are off while it is on.

## Linux (`linux/`)

Works:

- GTK 4 and libadwaita window with sidebar, header bars and light and dark theme tokens.
- Settings dialog and settings storage.
- API key storage in the Secret Service keyring, with an explicit error when no keyring is running.
- Desktop file, AppStream metadata and icon.
- Chat page: type a message, watch the reply stream in, see the tool steps and the speed, stop a turn, and answer the core's approval questions. It talks to an OpenAI-compatible server that is already running, through `draggy-core`'s `Session`.
- Saved conversations: each turn is saved. The sidebar's History list shows them newest first, and a click opens one. The + button starts a new conversation, and the trash button deletes one after a confirmation.
- Markdown in replies: headings, bold, italic, inline code, bullet and numbered lists, quotes, http and https links, and code blocks with a copy button. User messages and tables show as plain text.
- A paperclip button in the composer adds the text of a Word, PowerPoint, Excel or PDF file to the message, read by the core's `read_document`.
- The same button takes pictures (png, jpeg, gif, webp up to 10 MB). A toast confirms each one, and they go to the model with the next message through the core's `send_with_images`.
- Skills: the core lists the folders under `~/.local/share/draggy/skills` that hold a `SKILL.md` and gives the model a `use_skill` tool. There is no page to install or switch skills yet; put a folder there by hand.
- A Servers page lists the MCP catalogue with search and cautions, and starts or stops each server. Running servers feed their tools to chat sessions. CI compiles it, but nobody has run it on a desktop yet.
- A gear button on each server with inputs opens its settings: one field per environment variable or argument, secrets masked. Secrets go to the keyring and the rest to `~/.config/draggy/servers.json`. Start passes them to the core and names a required input that is empty.

- A Web group in settings turns on `search_web` and `read_url`: search engine choice, a SearXNG address, and a Brave key kept in the keyring. Pages on private addresses are refused, also after redirects.
- A Models page installs the llama.cpp engine, searches and downloads models with progress and cancel, lists and deletes downloaded files, and starts or stops the local server on the picked model. CI compiles it, but nobody has run it on a desktop yet.
- While a model loads, the page shows its steps with measured numbers only: "Getting <model> from disk...", "Loading <model> into RAM x%..." (the share of the file held in memory), "Reading x% (n tok/s)..." (the server's prompt progress and the speed between two reports), "<model> is readying..." and "Extending context x%..." when a running model restarts with a larger window. Percentages move in steps of 3.
- A Browser page on WebKitGTK with an address bar and back, forward and reload. Only http and https load, also for links and redirects, and local servers stay open. CI compiles it, but nobody has run it on a desktop yet.

Missing:

- HTML previews of model output and ad blocking in the Browser page.
- A signed, published release. A manual workflow builds an unsigned `.deb` and `.rpm`. Signing needs package keys. Flatpak is not started.
- Widget tests beyond two small ones that run under xvfb. The turn logic is tested without one.

Not verified on this branch's author machine (Windows): building and running the app. See `docs/linux.md` for the commands CI runs.

## macOS (`macos/`)

Works (as written, not yet compiled):

- SwiftUI window with a sidebar and a settings scene.
- API key storage in the Keychain.
- Chat page: type a message and watch the reply stream in through `draggy-core`'s `Session`, with Stop.
- The bindings pipeline: `macos/scripts/build-core.sh` builds the core, generates the Swift bindings and packs an XCFramework.
- The transcript on an `NSTableView` with TextKit 2 text views, with tool steps, tokens per second, and code blocks, inline code and bold drawn, headings, bullet lists, italics, quotes, tables and http or https links.
- The transcript shows the model's reasoning under a "Thinking" line, and each tool step with its full content, stdout and stderr in monospace. Not yet run on a Mac: only CI compiles it.
- A project folder, a permission mode, an option to allow commands, and an approval sheet for the core's questions.
- Every conversation is saved to its own file in `~/Library/Application Support/Draggy/Conversations` after each turn. The sidebar lists them under History, newest first, and a right-click deletes one. Tool steps are saved with each reply. The window shows the latest at launch, and the core gets a conversation back through `Session.restore` when the next message is sent. The single file older builds wrote is moved in as one conversation.
- A paperclip button in the composer that adds the text of a Word, PowerPoint, Excel or PDF file to the message, read by the core's `read_document`.
- The paperclip also takes pictures (png, jpeg, gif, webp up to 10 MB). They go to the model as image parts through the core's `send_with_images`, shown as chips above the field. A model that cannot see images is told so in the message.
- Skills: the core lists the folders under `~/Library/Application Support/Draggy/skills` that hold a `SKILL.md` and gives the model a `use_skill` tool. There is no page to install or switch skills yet.
- A `write_document` agent tool that saves .docx, .pptx and .xlsx files inside the project folder from HTML or Markdown, behind the permission prompt.
- A Servers tab in settings that lists the MCP server catalogue with search, cautions and documentation links, and starts or stops each server. Chat sessions use the same manager through `Session.withMcp`. A gear button opens a sheet with one field per environment variable or argument, secrets masked. Secrets go to the Keychain and the rest to user defaults. Start passes them to the core and names a required input that is empty.
- Interface text in English, French, Spanish and Chinese through a string catalog. A test checks that every key has all three translations and the same format placeholders. Text that comes from the core, such as tool step names, stays in English.
- The settings engine row shows the same load steps as the Linux Models page, in four languages.
- Rust core exports UniFFI `McpManager` and composite `Session.with_mcp` tool routing for MCP servers, ready for Swift app wiring.
- A Browser page with a WebKit view, an address bar and back, forward and reload. It keeps its cookies in a store separate from the app. Addresses pass the core's URL policy: only http and https load, and local servers are open to the user.
- VoiceOver support in the chat: each message reads as one row with who spoke and what was said, and the attach button has a label. Nothing in the app animates yet, so Reduce Motion has nothing to change. Other pages rely on SwiftUI's default labels and have not been checked with VoiceOver.
- A Web section in settings turns on `search_web` and `read_url`: search engine choice, a SearXNG address, and a Brave key kept in the Keychain. Pages on private addresses are refused, also after redirects.
- A macOS CI workflow.

Missing:

- Ad blocking and download prompts in the Browser page, and HTML previews of model output.
- Developer ID signing, notarization and Sparkle. A release workflow exists but signs ad hoc; the rest needs an Apple Developer account.

Not verified: none of the Swift has been compiled, since the author's machine runs Windows. See `docs/macos.md` for the likely failure points. The first macOS CI run is the first real check.
