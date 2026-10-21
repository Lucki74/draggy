# Native apps status

The Windows app is the Electron app in `win/`. The Linux and macOS apps are native and separate. All three share the Rust core in `core/` and the fixtures in `shared/fixtures/`.

Build 5 removed the Gemini CLI account route from the Windows app, because Google stopped serving it to personal Pro, Ultra and free accounts on 18 June 2026. The Rust core and the shared fixtures dropped it too, and the `google` catalog entry now names the Antigravity (`agy`) protocol. The core now holds the pure logic of the `agy` adapter (`core/crates/providers/src/agy/`: prompt, arguments, event stream, failures). The Linux and macOS apps still need the host wiring (process spawning and the terms warning) before they can sign in with Google.

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

Missing:

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
- The transcript on an `NSTableView` with TextKit 2 text views, with tool steps, tokens per second, and code blocks, inline code and bold drawn, headings, bullet lists, italics, quotes, tables and http or https links.
- The transcript shows the model's reasoning under a "Thinking" line, and each tool step with its full content, stdout and stderr in monospace. Not yet run on a Mac: only CI compiles it.
- A project folder, a permission mode, an option to allow commands, and an approval sheet for the core's questions.
- Every conversation is saved to its own file in `~/Library/Application Support/Draggy/Conversations` after each turn. The sidebar lists them under History, newest first, and a right-click deletes one. Tool steps are saved with each reply. The window shows the latest at launch, and the core gets a conversation back through `Session.restore` when the next message is sent. The single file older builds wrote is moved in as one conversation.
- A paperclip button in the composer that adds the text of a Word, PowerPoint, Excel or PDF file to the message, read by the core's `read_document`.
- A `write_document` agent tool that saves .docx, .pptx and .xlsx files inside the project folder from HTML or Markdown, behind the permission prompt.
- A Servers tab in settings that lists the MCP server catalogue with search, cautions and documentation links.
- Interface text in English, French, Spanish and Chinese through a string catalog. A test checks that every key has all three translations and the same format placeholders. Text that comes from the core, such as tool step names, stays in English.
- Rust core exports UniFFI `McpManager` and composite `Session.with_mcp` tool routing for MCP servers, ready for Swift app wiring.
- A Browser page with a WebKit view, an address bar and back, forward and reload. It keeps its cookies in a store separate from the app. Addresses pass the core's URL policy: only http and https load, and local servers are open to the user.
- VoiceOver support in the chat: each message reads as one row with who spoke and what was said, and the attach button has a label. Nothing in the app animates yet, so Reduce Motion has nothing to change. Other pages rely on SwiftUI's default labels and have not been checked with VoiceOver.
- A macOS CI workflow.

Missing:

- Image attachments. Numbered lists show as typed.
- Wiring MCP servers in the macOS app UI. The Servers tab only browses so far; the core now exports `McpManager` and composite `Session.with_mcp`, with Swift-side wiring up next.
- Ad blocking and download prompts in the Browser page, and HTML previews of model output.
- Signing, notarization, Sparkle and a release workflow.

Not verified: none of the Swift has been compiled, since the author's machine runs Windows. See `docs/macos.md` for the likely failure points. The first macOS CI run is the first real check.
