# Porting notes

The Rust core is a port of the Electron code, and the TypeScript stays the reference. The files in `shared/fixtures` run against both, so a difference listed here is one the fixtures do not catch. Each crate section says what was left out, what behaves differently, and what the next wave has to handle.

## Lone surrogates

A Rust string cannot hold a lone UTF-16 surrogate. Wherever the reference keeps one, such as a `\ud83d` escape in JSON or text cut in the middle of an emoji, the Rust code reads it as U+FFFD. This touches storage, diagnostics, agent and tools.

serde_json also rejects the escape outright. The bridge that passes renderer JSON into the core must replace lone surrogates before parsing, or a save or import fails where the Electron app succeeds.

## storage

The crate keeps the reference's quirks on purpose, so a database written by one side reads the same on the other:

- A chat saved with a null id is written as a row with a NULL id. SQLite never matches NULL, so every save adds a row.
- A numeric chat id is bound as a REAL, so 7 is stored as "7.0". A numeric message role is bound the same way.
- `delete_workspace` removes its chats one statement at a time without a transaction. A failure part way leaves the earlier chats deleted.
- A tool named `__proto__` is dropped, and `import_sessions` drops a session's plan and compaction.
- A falsy attachment name that is not null is indexed as its text, so 0 becomes "0".

Differences that remain:

- Integers above 2^53 in message fields keep their exact digits. The reference rounds them to a double.
- Whole floats and negative zero keep their float form in the stored payload (1.0, -0.0). The reference writes 1 and 0.
- `list_checkpoints` takes an `i64` limit. The reference throws on a fractional limit such as 2.5.
- After `close()`, every call returns `StorageError::Closed`. The per-call answers the reference gives (`{success:false,error}`, `[]`, `null`, `0`) live in the fixture runner, and the IPC layer has to reproduce them.
- `close()` keeps the real connection open if opening the in-memory replacement fails. Every later call is still refused.
- `open()` discards the error when it reads the schema version, without logging it. The house rule says every swallowed error logs.
- The fixture runner converts arguments with Rust rules, not JavaScript's. A case written with an odd value (`"inf"`, `"0x10"`, `1e21`) can pass or fail for the wrong reason.

## diagnostics

Not ported: the terminal mirror in `logger.cjs` (console output when the app is unpackaged) and the variadic `log.info(scope, ...parts)` form. The Rust logger takes one message and one data value.

Differences:

- `errorsByScope` with a scope named like an `Object.prototype` member (`constructor`) gets a string count in the reference. Rust does not copy that.
- A renderer error sent as a plain string has no stack in Rust. The reference builds one with `new Error()`, so its logs carry logger frames.
- A non-object `cause` cannot be represented. The reference renders it as `{name:"NonError"}`.
- `LevelChange.level` cannot be null, so Rust cannot reset the level to the startup value the way `setLevel({level:null})` does. `max_bytes` has no normalisation of 0 to 5 MiB, although nothing reaches it through `from_env`.
- The query-string and authorization scrub rules also match U+017F and U+212A, so they over-scrub slightly.

Privacy: error messages reach `debug.log` and `events.jsonl` whole, scrubbed only by the known patterns and the registered values. This is the same as the Electron logger. A secret that matches no pattern and appears in an error text would be written in plaintext, which sits badly with the rule that keys and tokens never reach disk. Decide before the first native release whether the core should scrub error text harder than the reference does.

## agent

Ported: parsing, prompts, repetition detection, announcements, command rules and permissions. Not ported: the registry-backed `detectToolCall`, `stripToolSyntax` and `onRegistryChange` (the caller passes names instead), the constants `MAX_TOOL_LOOPS` and `STREAM_UI_INTERVAL_MS`, and the `availableTools` filter, which belongs to the agent loop in the next wave.

Differences:

- JSON nested deeper than 512 levels is rejected. `JSON.parse` accepts it, so a tool call body nested 600 deep falls back to raw text in Rust.
- Registered names with several lowercase forms (sigma, beta, theta variants) miss some case forms that JavaScript's `i` flag matches.
- The orphan-brace pattern runs on `fancy-regex`, which stops after one million backtracking steps. On a very large malformed input a later match could be missed.
- Direct `parse_tool_call` of an out-of-range number reads as null where the reference gives Infinity. The detect output matches.
- Number text follows JavaScript's choice of shortest digits, and integer-like object keys list first, as `JSON.stringify` does.

## models

Not ported: tensor info (the reference has no tensor reader), `ensureFamilyDraft` (the download wave), and the `mlxLadder` and `modelRecommendations` aliases of the one ladder. The refused sets and the chosen-draft map are now owned by `Projectors` and `Drafts` values, so each owner starts empty instead of sharing module state. Log lines are not pinned by fixtures. The tracing targets reuse the TypeScript scopes (`engine.gguf`, `engine.vision`, `engine.draft`, `engine.shards`).

Quirks kept from the reference:

- Metadata goes through `Number()`, so "4096" reads as 4096, `true` as 1 and "abc" as null.
- A walk cut short by a truncated value returns the partial header. Only short input, bad magic and an unsupported version return null.
- `key_length` and `value_length` fall back to the embedding length divided by the head count, which is wrong for models whose head size differs.
- "Apple M2Promax" reads as a Pro chip, because no separator is needed before the variant.
- On Apple Silicon with RAM known, the recommendation ignores VRAM, as the source comment says it should.

Differences:

- Hex, binary and octal strings above 2^53 are summed in `f64` and can round differently from V8's `Number()`.
- `skip_value` walks nested arrays with an explicit stack. The reference throws a `RangeError` at about 10,000 levels.
- The reference's debug logs for GGUF read failures are not ported. The draft chosen and cleared lines log at debug here and at info in the reference.
- `model_recommendations.rs`, `model_kinds.rs` and `vram.rs` sit in the models crate. The plan maps `src/modelRecommendations.ts` and `src/vram.ts` to `engine::recommend`, so the boundary needs a decision.
- `vram.json` writes NaN and Infinity as the strings "NaN" and "Infinity". The fixture README says plain JSON only. The Rust `canon()` turns a non-finite result into null, so a regression that produced NaN would match an expected null.

## tools

The sandbox checks were fixed in the Electron code and the Rust port together, and the fixtures pin the new behavior. Three holes closed:

- A dangling symbolic link as the last part of a requested path is refused. Before, it passed because the existence check followed the link, so a write could create a file wherever the link pointed. A dangling link in the middle of a path stays allowed for new folders, since the write fails there and creates nothing outside.
- Reading a file inside a skill folder now resolves the real path and requires it to stay inside the folder. A real path that holds a denied name is refused with a credentials message.
- The denied-name test runs on the name as given and on its NFKC form, so the Kelvin sign no longer slips past a check for `.k` names. Both sides use `unicode-normalization`.

Collation moved to `icu_collator` with root options. The collation fixture grew from 110 to 204 cases generated by Node, and a seeded comparison of several thousand random pairs found no disagreements with `localeCompare(b, "en")`. The reference calls `localeCompare` with no locale, so it follows the machine language. On a Swedish system Node sorts the letter a with diaeresis after z, and the Rust port sorts it with a. Passing the app locale into the core would remove the gap. Until then, folder, skill and skill file order can differ for users whose system language is not English.

`kill_tree` now sends SIGKILL to the whole group at once and does nothing after the child has exited, as `platform.cjs` does. Two things follow from that, and both match the reference. After a timeout, `run()` still waits for any pipe a surviving grandchild holds, so a daemon started with `&` can keep a tool call open indefinitely. The Rust port also has no fallback to killing the child alone if the group kill fails. The Windows branch of `kill_tree` was not compiled here.

Decisions still open:

- `listFiles` and `collect_files` list the names of files under denied folders, such as `credentials.d/x.txt`. Contents are refused. Hiding the names would change the reference too.
- Should `run()` bound how long it waits for the pipes to drain after a timeout.
- Log fields differ slightly from the reference. Some refusals log a different rule name or no path, one collator error uses a single segment target, and the skill source logs as `Library` where the reference logs `library`.
- A SKILL.md that vanishes between listing and reading gives an `open` message in Rust and a `realpath` message in TypeScript.

## web

Ported: the URL policy, page fetching with a JSON and DOM extractor, connectivity checks and the search scrapers. Not ported: page scripts and the readiness wait. The Rust fetcher parses the HTML it receives, so pages that build their text with JavaScript read as nearly empty. The Electron app loads those in a hidden window.

The URL policy was tightened in the Electron code and the Rust port together. Trailing-dot hosts, IPv4-mapped IPv6 such as `[::ffff:7f00:1]`, `[::]`, fe80::/10 and 100.64.0.0/10 are refused. Eight URL rows and five hostname rows in the fixtures changed from allowed to refused.

Gaps that remain:

- Site-local fec0::/10 and hosts with two trailing dots stay fetchable, and a test pins both. IPv4-compatible forms such as `::127.0.0.1` and the translated form `::ffff:0:7f00:1` are also fetchable on both sides. Localhost aliases beyond the three in the list, such as `localhost6`, are not in it.
- `http://xn--localhost-/` is fetchable in Node and refused as invalid by the `url` crate. No fixture pins it.
- Relative links resolve against the requested URL, not the final one after redirects.
- `UrlPolicy` does not see redirect hops, so the native fetcher must check each hop itself. Electron now checks them for the page reader only, through `will-redirect`, `will-navigate` and `will-frame-navigate` on that hidden window. That code has no test and was not run in Electron. It reads the hop from the deprecated second argument. The subframe handler skips every scheme other than http and https.
- The hidden windows used for page reads, scraping and the browser tool had no `setWindowOpenHandler`, so a page could open a window at an address the policy refuses. All three now deny new windows. This is not covered by a test.
- `parse_json` rejects lone surrogates and numbers out of range, where `JSON.parse` accepts them.
- The native shell has to enforce `permissionGranted`: camera and microphone only from the app window, and the sanitized clipboard write only from app pages.

## engine

Ported: the llama process supervisor, argument building, health checks, output parsing, draft statistics, flag cache, binary manager, engine updater, hardware and VRAM probes. Two holes in the first port were fixed. A start that is dropped while loading no longer strands the next one, and a launch no longer overwrites a process another start still holds.

Differences:

- The RAM and VRAM lines the reference logs before and after each load and after each unload are not written.
- A binary that fails to spawn is reported at once. The reference waits out the full load deadline first.
- The health check applies one deadline to connect, write and read. The reference uses an idle-socket timeout, so a slow answer that keeps progressing is cut off here.
- Two same-model starts racing on a multi-threaded runtime can both launch, because the join check and the slot claim use two locks. The window is microseconds and no test reproduces it.
- A hand-edited `draft-stats.json` with a null or missing sample count behaves differently from the reference.
- On Windows the spawn error code is empty for every failure except a permission error. That branch was not compiled here.

## providers

Ported: the neutral chat types, the OpenAI, Anthropic, Gemini and Ollama adapters, the claude, codex and gemini CLI adapters with their installers and the account supervisor, the gateway, the catalog, model listings, the registry, the signed catalog and local discovery. Network and storage are traits.

The last round fixed the streaming gateway so that a reader that goes away stops the upstream request, falsy RPC errors that settle with the result, the codex handshake literal, single-flight installs and streamed downloads. Fixtures cover installs, the supervisor and the MCP keep-alive.

This crate had no independent verification of its final state. Only the format, lint and test gates in this repo cover it, so treat it as the least reviewed of the wave.

Small known differences: the chat check compares the host without the port, and non-stream account tool calls drop their index.

## model store

Ported: the Hugging Face resolver, the model cache, downloads with resume, and the JS helpers they need.

Differences:

- `locale_cmp` in the models crate is an ASCII-fold approximation of root collation, not `localeCompare`. It breaks projector ties and sorts shards. Punctuation can order differently. The tools crate uses the real ICU collator, so the two should share one.
- A 204 or 205 answer is written to the cache as an empty model file. The reference refuses it.
- An empty `Location` header returns the 3xx answer. Node follows it to the same URL and fails after twenty hops.
- A cache root containing `..` resolves to a different folder than `path.resolve` gives.
- The two download paths read Content-Length differently. Values such as `+5` or `1e3` pass in one and not the other.
- `cancel()` removes the partial file without waiting for the transfer to let go of it.
- The tools template check uses Unicode word boundaries where JavaScript uses ASCII ones.
- The reference builds a nonsense URL for a curated key such as `llama3.1:constructor`. The port falls back to the first size.

## agent loop

Ported: the run loop, turn preparation, compaction, context breakdown, resume, task manager, live turn, subagents, tool channel and skill loading. The loop is pinned by a name-by-name mapping of the 131 TypeScript loop tests to Rust tests.

Not ported: the window high-water rule for context size (it lives in the engine host and no Rust crate implements the engine host trait yet), so only the loop side is pinned. A provider state that is not in the typed wire shape is dropped, where TypeScript passes it through. The tail notes are kept per conversation instead of in a module map.

## mcp

Ported: the client, stdio and HTTP transports, tool results, npm provisioning, OAuth sign-in and sign-out with PKCE, token refresh on a 401, and the stdio supervisor. JSON text follows `JSON.stringify`, including number text and key order, and whitespace trimming follows JavaScript.

Differences and gaps:

- Environment and header values never appear in `Debug` output, only their names.
- A JSON null line is handled the way the reference does by accident, and the quirk is pinned.
- The stdio launcher goes through `exec_hidden` for the npm install. Running the server itself needs a spawn with a piped stdin in the tools crate, which does not exist yet. A real stdio server was not run here.

## documents

Ported: DOCX, XLSX, PPTX, CSV and PDF reading, the generated file writers and the three HTML writers. The Chromium PDF step is not ported.

Differences:

- PDF glyph clipping differs from pdf.js. The password, page limit and text limit cases are fixtured.
- XLSX infinity values are not changed to match the reference.
- The write logs, the timed `write docx` line and the failure step, are not ported. Rust logs a debug line on success only.
- Date text is printed in UTC, and the runner sets `TZ=UTC` so the reference matches.
- Columns past 16384 are refused with the reference message, only when the cell is present.

## api

Ported: the local OpenAI-compatible server, routing, auth, request parsing and error bodies.

Differences, none pinned by a fixture:

- Only one leading `//` pair is stripped. The reference skips every leading slash or backslash, so `///v1/models` answers 200 here and 404 there.
- Authenticated `//` and `/\` paths make `new URL()` throw in the reference, which answers 500. Rust answers 404.
- A listen failure other than address in use returns the Rust error text instead of Node's message.
- Lone surrogate escapes and numbers beyond f64 answer 400 in Rust and 200 in the reference. Nesting deeper than 128 levels answers 400.
- The Rust fixture runner coerces malformed inputs silently, so a future case could pass in Rust and fail in TypeScript.

## secrets

Ported: the secret store, adopt, the scrubber and the fake vault.

Quirks kept on purpose: an owner named `__proto__` is dropped from the records, stored owner values that are not objects are returned as stored, array stores grow on a set past the end and do not shrink on remove, and the vault decodes base64 the way Node's `Buffer.from` does. `SecretStore::get` returns the raw JSON value, and `with_secrets` takes the environment as a JSON value. The scrubber threshold counts UTF-16 units, so five accented letters pass and six are scrubbed.

The secrets test installs a scoped tracing subscriber, which has the same callsite-cache race the agent crate hit.

## Fixture harness

Expected values come from the TypeScript reference, produced by a throwaway generator that is deleted afterwards. The DOM and decode expectations in the web fixtures come from a TypeScript stand-in, and `wellFormed` hides lone surrogates there. That limits what those fixtures prove.
