# Codex spike results (MODE.md)

Pinned: **Codex 0.157.1** (`rust-v0.157.1`, published 2026-09-26). Spike run on 2026-09-27, Windows 11 x64.
Everything below was measured against the pinned binary unless marked **unverified**. No ChatGPT
account was signed in: every turn ran against a local mock of the Responses API, configured as a
custom model provider in a private `CODEX_HOME`, which records exactly what Codex would have sent
to the model. What only a signed-in account can show is listed at the end, for the Phase 2 checklist.

## 1. Terms (hard rule 11)

The maintainer confirmed on **2026-09-26** that OpenAI allows a third-party app to offer ChatGPT
sign-in through the official Codex runtime. Not re-checked, by instruction.

## 2. Version and schema

- `electron/providers/codex/schema/` is the output of
  `codex app-server generate-ts --experimental --out <dir>` for 0.157.1 (881 files). The
  `--experimental` build is the one committed, because Draggy needs `experimentalApi` (§6).
  Regenerate it on every bump.
- Every method the spec names exists in the generated `ClientRequest` union: `initialize`,
  `thread/start`, `turn/start`, `turn/interrupt`, `thread/inject_items`, `model/list`,
  `account/read`, `account/login/start`, `account/login/cancel`, `account/logout`,
  `account/rateLimits/read`.
- Server-to-client requests (`ServerRequest`): `item/tool/call` (dynamic tools),
  `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`,
  `item/permissions/requestApproval`, `applyPatchApproval`, `execCommandApproval`,
  `item/tool/requestUserInput`, `mcpServer/elicitation/request`,
  `account/chatgptAuthTokens/refresh`, `attestation/generate`, `currentTime/read`.

## 3. Stripping every Codex built-in (hard rule 12): possible in 0.157.1

Measured by the tools array (and the `additional_tools` input item) Codex sent to the mock.

**Default** (gpt-5.5): `exec_command`, `write_stdin`, `request_user_input`, `apply_patch`,
`view_image`, `get_goal`, `create_goal`, `update_goal`, `tool_search`, `web_search`, plus 21,299
characters of Codex instructions, a skills developer message, a permissions developer message and an
environment context message.

**Default** (gpt-6-*, gpt-5.6-*, daybreak, codex-auto-review): these catalog entries have
`tool_mode: "code_mode_only"`, `multi_agent_version`, `use_responses_lite: true` and
`experimental_supported_tools`. Codex then sends no `tools` field at all; the tools travel in an
`additional_tools` input item: `functions{exec, wait, request_user_input(_async)}`,
`clock{sleep | curr_time}`, `collaboration{followup_task, interrupt_agent, list_agents,
send_message, spawn_agent, wait_agent}`. `exec` is a JavaScript isolate that calls the other tools.
**No feature flag or config key removes these**: they come from the model catalog.

**Stripped** (every model in the bundled catalog, 11 of them): the model sees exactly Draggy's
dynamic tools, Draggy's instructions, and the conversation. Nothing else. Four parts, all needed:

1. `config.toml`, written by Draggy before every start (from Codex's own
   `tui/src/temporary_structured_request.rs` key list, plus the rest found in the binary):

   ```toml
   model_catalog_json = "<CODEX_HOME>/draggy-models.json"
   web_search = "disabled"
   forced_login_method = "chatgpt"
   cli_auth_credentials_store = "file"
   check_for_update_on_startup = false
   include_permissions_instructions = false
   include_environment_context = false
   include_apps_instructions = false
   include_collaboration_mode_instructions = false
   project_doc_max_bytes = 0
   [analytics]
   enabled = false
   [feedback]
   enabled = false
   [features]
   code_mode = false
   code_mode_only = false
   context_management = false
   current_time_reminder = false
   deferred_executor = false
   image_generation = false
   memories = false
   multi_agent = false
   multi_agent_v2 = false
   plugins = false
   request_permissions_tool = false
   shell_snapshot = false
   shell_tool = false
   standalone_web_search = false
   token_budget = false
   tool_suggest = false
   unified_exec = false
   view_image = false
   goals = false
   apps = false
   browser_use = false
   computer_use = false
   in_app_browser = false
   skill_search = false
   sleep_tool = false
   hooks = false
   [skills]
   include_instructions = false
   [cloud.skills]
   enabled = false
   [tools.experimental_request_user_input]
   enabled = false
   [tools.update_plan]
   enabled = false
   ```

   Removes: `exec_command`, `write_stdin`, `apply_patch`, `view_image`, goals, `tool_search`,
   `web_search`, `request_user_input`, the skills and permissions developer messages, the
   environment context.
2. `thread/start` with `environments: []`: no environment access for the thread (removes the
   shell and patch tools independently of the features above).
3. `model_catalog_json`: a copy of the bundled catalog (`codex app-server` reads it; the pinned
   binary's own catalog is embedded and was extracted for this) with, for every model,
   `tool_mode: null`, `multi_agent_version: null`, `use_responses_lite: false`,
   `experimental_supported_tools: []`. Removes code mode (`exec`, `wait`), the collaboration
   (multi-agent) tools, `clock` and `request_user_input_async`, and the multi-agent developer
   messages. Draggy writes this file; it is not a Codex feature switch.
4. `baseInstructions` on `thread/start` replaces Codex's 21k-character prompt entirely (the
   request's `instructions` becomes exactly Draggy's text).

**Re-proving it:** `node scripts/codex-probe.cjs <codex-app-server binary>` extracts the binary's
catalog, writes this config and the plain catalog, and runs one turn per catalog model against a
mock, failing if anything but Draggy's tool and instructions reaches the model. On 0.157.1: all 11
pass. Shown failing: with the `tool_mode` reset left out, 8 models get `exec` and `wait`. Run it on
every bump. For Phase 2, ship the plain catalog generated for the pinned version beside the checksums
rather than extracting it at run time.

**Start with `--strict-config`.** Without it, an unknown or mistyped key makes Codex log
"Invalid configuration; using defaults", which brings every built-in back. With it, the process
exits at once with the offending line, so a bad config is `account-runtime-unavailable`, never a
thread with tools. Measured both ways.

**Backstop** (§4.5) for anything that still asks: answer `item/commandExecution/requestApproval`,
`item/fileChange/requestApproval`, `item/permissions/requestApproval`, `applyPatchApproval`,
`execCommandApproval` with a denial, `item/tool/requestUserInput` and
`mcpServer/elicitation/request` with a decline, then `turn/interrupt` and `provider-unknown-error`.
None of them fired in any stripped run.

## 4. Tools mode: **A** (client tools)

- `thread/start.dynamicTools: [{ type: "function", name, description, inputSchema }]`
  registers Draggy's `toolDefinitions`. Requires `experimentalApi`.
- A call arrives as the server request `item/tool/call`
  `{ threadId, turnId, callId, namespace, tool, arguments }`. The adapter emits it as
  `delta.tool_calls` + `finish_reason: "tool_calls"`, keeps the turn open, and answers the RPC
  with `{ contentItems: [{ type: "inputText", text }], success }` when the next gateway request
  carries the result. Measured: the next model request carries `function_call` and
  `function_call_output` with the answer, and the turn completes.
- **Pending call timeout:** none found. Calls answered after 150 s and after 10 minutes were
  accepted and the turn completed, so no "still waiting" answer is needed. No model request is open
  while a call waits: the response carrying the call has already completed, and Codex sends the
  next request only once the result arrives.
- **Stop while a call is pending:** `turn/interrupt` ends the turn with status `interrupted`; no
  further model request is made. Keep `provider_state` only up to the last completed turn.
- **Restart:** threads are ephemeral (§5), so after any restart the next request finds no thread
  and reseeds.

## 5. Turns, seeding and system prompt

- **Seeding: structured.** `thread/inject_items { threadId, items }` takes raw Responses items;
  `{type:"message", role:"user"|"assistant", content:[{type:"input_text"|"output_text", text}]}`
  arrived at the model in order as real messages, before the new user input, and the next turn on
  the same thread carried them plus the new exchange. No flattened preamble is needed.
- **Quota cost of seeding:** the seeded history is ordinary input, so a reseed costs one full
  prompt of the transcript's length on the next request, the same as any turn replaying that much
  history; later turns on the thread add only the new messages. **Not measured against real plan
  quota** (needs an account).
- **System prompt:** `baseInstructions` replaces Codex's instructions (measured: `instructions`
  = Draggy's text only). `developerInstructions` is also accepted and adds a developer message;
  Draggy needs only `baseInstructions`.
- **Ephemeral threads:** `thread/start.ephemeral: true`. Measured: with it, no conversation text
  appears anywhere in `CODEX_HOME`; without it Codex writes a rollout `.jsonl` and two sqlite
  databases holding the conversation. Use ephemeral; reseed after a restart.
- **Streaming:** `item/agentMessage/delta { itemId, delta }` → `delta.content`;
  `item/reasoning/summaryTextDelta { itemId, delta, summaryIndex }` → `delta.reasoning_content`;
  `turn/completed { turn: { status, items } }` → finish (`completed`, `interrupted`, or failed with
  `error`); `thread/tokenUsage/updated` → usage.
- **Interrupt:** `turn/interrupt { threadId, turnId }` → `turn/completed` with status
  `interrupted`; the upstream HTTP request was closed at once (measured 1,458 ms after a turn
  started, for an interrupt sent at 1,500 ms).
- **Reasoning effort:** `turn/start.effort` (and `turn/start.summary` for reasoning summaries),
  from the schema; `model/list` returns the supported efforts per model (`low` to `max`/`ultra`).
  Map low / medium / high directly. Not exercised against a real model.

## 6. `experimentalApi`

Needed, at `initialize` (`capabilities.experimentalApi: true`). Measured: without it,
`thread/start` fails with "thread/start.environments requires experimentalApi capability";
`dynamicTools` is also experimental-only in the generated types. `thread/inject_items`,
`baseInstructions` and `ephemeral` are in the stable schema.

## 7. Account

- `account/read` → `{ account: null | { type: "chatgpt", email, planType }, requiresOpenaiAuth }`.
  Unsigned: `account: null, requiresOpenaiAuth: true`.
- `account/login/start { type: "chatgpt" }` → `{ loginId, authUrl }`. The URL is
  `https://auth.openai.com/oauth/authorize?...&redirect_uri=http://localhost:1455/auth/callback&originator=draggy`:
  OpenAI's own authorization server and Codex's own local callback listener, so no server but the
  vendor's is involved (hard rule 11). `originator` comes from `clientInfo.name`. Fallback
  `{ type: "chatgptDeviceCode" }` → `{ verificationUrl, userCode }`. `account/login/cancel
  { loginId }` → `canceled` (measured). Completion arrives as `account/login/completed`.
- **Never used:** `{ type: "chatgptAuthTokens" }` (Draggy would be supplying tokens) and
  `{ type: "apiKey" }`. `forced_login_method = "chatgpt"` pins it. If Codex ever sends
  `account/chatgptAuthTokens/refresh` (only in external-token mode, which Draggy never enters),
  answer with an error: Draggy never refreshes or mints a token.
- `account/rateLimits/read` → `rateLimits.primary/secondary { usedPercent, windowDurationMins,
  resetsAt }`, plus `rateLimitReachedType`. Unsigned: error "authentication required".
- `model/list` works unsigned (bundled catalog): gpt-6-astra (default), gpt-6-sol, gpt-6-luna,
  gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.5, each with `inputModalities`
  `["text","image"]` and its reasoning efforts.
- **Credentials:** `cli_auth_credentials_store = "file"` keeps the tokens in
  `<CODEX_HOME>/auth.json`, inside Draggy's private folder. Chosen over `"keyring"` because 0.157.1
  also keeps an encryption key for its secrets store in the OS keyring, and whether that entry is
  per `CODEX_HOME` or shared with the user's own Codex could not be checked without signing in.
  A shared entry would mean reading another app's keychain item (hard rule 11). The Codex keyring
  entry for auth itself is `Codex Auth` / `cli|<hash of CODEX_HOME>` (per instance).
  **Question for the maintainer:** file storage in the private folder, or keyring once verified.

## 8. Runtime and process

- **Native binary:** the release ships a standalone app-server per platform:
  `codex-app-server-<target>` (`x86_64-pc-windows-msvc.exe`, `aarch64-pc-windows-msvc.exe`,
  `x86_64-apple-darwin`, `aarch64-apple-darwin`, `x86_64-unknown-linux-musl`,
  `aarch64-unknown-linux-musl`), as `.zip`/`.tar.gz`/`.zst`, each with a SHA-256 in the release
  metadata. Windows x64: `.exe.zip` 79,967,102 bytes,
  `85ca951a6859757fe425407c4afe3ee1c59f3d35f739cdbd3be109393493048c`; the unpacked `.exe`
  `f768e4edc401cfe9c40c70e6175b046a48e017e7b20c28ff833196e30c84827a` (both verified). It runs
  the same protocol with the same flags (`--strict-config`, `--listen stdio://`) and passed the
  same stripped run. Download this, not the 322 MB full CLI.
- **`codex` on PATH:** npm installs a `codex.cmd`/`bin/codex.js` shim; the native binary is at
  `node_modules/@openai/codex-<platform>/vendor/<target>/bin/codex.exe` (its SHA-256 matched the
  release asset `codex-x86_64-pc-windows-msvc.exe`). That one runs `codex app-server`. Simpler to
  always download the pinned app-server asset than to trust a PATH install of another version.
- **Session source:** both binaries default to `--session-source vscode`, which would present
  Draggy as the VS Code extension. Start with `--session-source draggy`: measured, the thread
  reports `{ custom: "draggy" }` and everything above still works. **Unverified:** whether the
  ChatGPT backend treats a custom source differently for plan access.
- **Environment:** measured working with only `PATH`, `SystemRoot`, `TEMP`, `TMP`, `CODEX_HOME`,
  and `USERPROFILE`/`HOME` pointed at the private folder. Codex refuses to create its PATH helper
  aliases under a temp directory (a warning only); app data is not a temp directory.
- **Private home contents:** `config.toml`, `installation_id`, sqlite databases for goals, logs,
  memories, queue and state, `skills/.system`. Nothing about an ephemeral conversation.
- **Analytics:** app-server has `--analytics-default-enabled`; without it analytics start off, and
  `[analytics] enabled = false` keeps them off. **Unverified:** which hosts a signed-in Codex
  contacts besides the model endpoint (plugin sync, model catalog refresh); check in Phase 2 with
  the privacy policy table in mind.

## 9. Alternative runtime

Not needed: app-server strips every built-in in 0.157.1, so `codex-acp` was not tried.

## Phase 2 checklist (needs a signed-in Plus or Pro account)

1. Sign in with the browser flow and with the device code; `account/read` shows email and plan.
2. With the Draggy config and the plain catalog, a real turn on gpt-6-astra, gpt-5.6-sol and
   gpt-5.5: the reply streams, tools work, and the backend accepts non-code-mode requests for
   the gpt-6 and gpt-5.6 models. If it refuses them, offer only the models whose bundled
   `tool_mode` is null (gpt-5.5, gpt-5.4) and record it here.
3. The model catalog Codex uses when signed in is still Draggy's file (a remote catalog refresh
   must not bring `tool_mode` back): compare `model/list` and one request's tool set.
4. `--session-source draggy` does not change plan access.
5. Rate limits read, and the limit-reached error with its reset time.
6. Where the tokens land (`auth.json` in the private folder) and that `~/.codex` is untouched.
7. Hosts contacted by a signed-in run (for the privacy policy).
8. Sign out.
