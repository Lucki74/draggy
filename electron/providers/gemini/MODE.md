# Gemini CLI spike results (MODE.md)

Pinned: **Gemini CLI 0.61.0** (npm `@google/gemini-cli`, the `latest` tag on 2026-09-27; Apache-2.0).
Spike run on 2026-09-27, Windows 11 x64. Everything below was measured against the pinned CLI unless
marked **unverified**. No Google account was signed in: every turn ran over ACP against a local mock
of the Gemini API (`GOOGLE_GEMINI_BASE_URL` plus a dummy key, set for the spike's mock only; Draggy
itself never passes either, hard rule 13), which records exactly what the CLI sends to the model.
Draggy's tools were served by a local HTTP MCP server. What only a signed-in account can show is
listed at the end, for the Phase 2b checklist.

## 1. Terms and data use (§4.8.1)

- The maintainer confirmed on **2026-09-26** that Google allows a third-party app to offer Gemini
  sign-in with a Google account through the official Gemini CLI. Not re-checked, by instruction.
- **Data use per tier, for the privacy policy: not recorded.** The spike was told not to look up
  vendor terms, and Google's privacy notice for the CLI is one. The maintainer writes this wording.

## 2. Install and launch

- `npm install --ignore-scripts @google/gemini-cli@0.61.0` into `<userData>/gemini/cli` (7 packages,
  about 108 MB). `--ignore-scripts` is enough: the one native dependency, `node-pty`, serves the
  shell tool, which is stripped. Integrity comes from the lockfile npm writes.
- Entry point `node_modules/@google/gemini-cli/bundle/gemini.js`, run with `ELECTRON_RUN_AS_NODE=1`
  by Electron 42's own executable: measured, every check below passed that way. Never `npx`, never
  the `.cmd` shim.
- **ACP flag: `--acp`** (`--experimental-acp` still works but is deprecated in 0.61.0).
- **`--skip-trust` is required.** Without it the private working folder counts as untrusted, and in
  an untrusted workspace the CLI connects no MCP server at all, so Draggy's tools would be missing.
  It trusts only the current working directory, for that session. The folder is Draggy's own,
  empty, private one.
- Console window: a packaged Draggy starts it through `platform.spawnHidden`; **not measured from a
  GUI process** in the spike.

## 3. Stripping every built-in (hard rule 12): possible in 0.61.0

Measured by the `tools` sent with each `streamGenerateContent` request.

**Default:** 15 built-in tools: `update_topic`, `list_directory`, `read_file`, `grep_search`,
`glob`, `replace`, `write_file`, `web_fetch`, `run_shell_command`, `list_background_processes`,
`read_background_output`, `google_web_search`, `enter_plan_mode`, `invoke_agent`, `activate_skill`
(one more appears with a fixed model), a 24,557-character system prompt, and, with the model left on
`auto`, an extra routing request that sends the conversation to a flash-lite model first.

**Stripped:** the model sees only Draggy's tools. `<GEMINI_CLI_HOME>/.gemini/settings.json`, written
by Draggy before every start:

```json
{
  "tools": { "core": ["mcp_draggy_<tool>", "…one entry per Draggy tool"] },
  "model": { "name": "<the chosen model>" },
  "context": { "includeDirectoryTree": false },
  "general": { "enableAutoUpdate": false, "enableAutoUpdateNotification": false, "checkpointing": { "enabled": false } },
  "privacy": { "usageStatisticsEnabled": false },
  "telemetry": { "enabled": false },
  "skills": { "enabled": false },
  "hooksConfig": { "enabled": false },
  "security": { "auth": { "selectedType": "oauth-personal" } }
}
```

- `tools.core` is an allowlist over **every** tool, MCP included. Measured: `[]` removes Draggy's
  tools too; naming each Draggy tool as `mcp_draggy_<name>` leaves exactly those. `tools.exclude`
  is not usable: it matches a tool's own name, so excluding the built-in `read_file` also removed
  Draggy's MCP `read_file`.
- A fixed `model.name` removes the routing request.
- **Backstop, measured:** when the mock made the model call `run_shell_command`, the CLI answered it
  with "Tool \"run_shell_command\" not found in registry" without running it or asking. Draggy's own
  backstop stays: any `session/request_permission` for a tool that is not one of Draggy's is
  rejected, followed by `session/cancel` and `provider-unknown-error`. None fired in the spike.
- `--yolo` and the `yolo` session mode are never used.
- **Re-proving it on a bump:** `node scripts/gemini-probe.cjs <bundle/gemini.js>` runs one ACP turn
  with these settings against a mock, where the model first calls `run_shell_command`, and fails
  unless only Draggy's tool is listed, Draggy's prompt replaces the CLI's and the call is refused
  unrun. On 0.61.0 all four checks pass. Shown failing: without `tools.core`, two checks fail and
  the injected `run_shell_command` ran without asking.

**What the CLI still adds:**
- A `<session_context>` user message: date, OS, the project's temporary directory and workspace
  directory (paths under the private folder, which contain the Windows user name) and, unless
  `context.includeDirectoryTree` is false, a listing of the workspace. **Question for the
  maintainer:** a working directory whose path has no user name, or accept it.

## 4. Tools: Draggy's MCP server (mode B), over HTTP

- The CLI speaks HTTP MCP (`mcpCapabilities: { http: true, sse: true }`), so Draggy serves its tools
  from the main process on a loopback port, with no bridge process. Declared in `settings.json`
  (below, for the timeout); `session/new { mcpServers: [{ type: "http", … }] }` works too but cannot
  carry a timeout. Measured: `initialize`,
  `notifications/initialized`, `tools/list`, then `tools/call` for the model's call; the next model
  request carried the result. Tools appear as `mcp_draggy_<name>`.
- The CLI sent no `session/request_permission` for Draggy's tool in default mode; Draggy's own
  approval card runs inside its MCP handler, as for every other tool.
- **Pending calls (a tool waiting on the user's approval), measured:**
  - A plain JSON reply fails after about 60 s with "fetch failed": the CLI's HTTP client gives a
    response 60 s to send its headers. So Draggy answers `tools/call` as an SSE stream (allowed by
    streamable HTTP): headers at once, a `: keep-alive` comment every 30 s, then the result. With
    that, an answer after 150 s worked.
  - The CLI's own MCP call timeout is 10 minutes, and an answer after 10 minutes failed. Only a
    server declared in `settings.json` can raise it, so Draggy declares its server there instead of in
    `session/new`: `"mcpServers": { "draggy": { "httpUrl": "http://127.0.0.1:<port>/<secret>",
    "timeout": 86400000 } }`. Measured with SSE replies: an answer after 10 minutes completed.
  - The CLI wraps an MCP result as `<untrusted_context>…</untrusted_context>` before the model sees it.
- The HTTP MCP endpoint must accept only this child: a random path or a bearer header per start,
  bound to 127.0.0.1 (**to design in Phase 2b**).

## 5. Turns

- `initialize { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false,
  writeTextFile: false }, terminal: false } }` → `agentCapabilities: { loadSession: true,
  promptCapabilities: { image, audio, embeddedContext }, mcpCapabilities: { http, sse } }`.
- `session/new` returns the session id, modes (`default`, `autoEdit`, `yolo`, `plan`) and models
  (`auto`, `gemini-2.5-pro`, `gemini-3.8-flash`, `gemini-3.5-flash-lite` unsigned).
- `session/prompt { sessionId, prompt: [{ type: "text", text }, { type: "image", mimeType, data }] }`
  → `{ stopReason, _meta: { quota: { token_count, model_usage } } }`. Images measured: they reach
  the model as `inlineData`.
- **Stream mapping,** from `session/update`: `agent_message_chunk` → `delta.content`,
  `agent_thought_chunk` → `delta.reasoning_content`, `tool_call` / `tool_call_update` for Draggy's
  own tool, the prompt's `stopReason` (`end_turn`, `cancelled`) → `finish_reason`.
- **Stop:** the `session/cancel` notification. Measured: `stopReason: "cancelled"`, and the upstream
  request closed about 43 ms after the cancel.
- **System prompt:** `GEMINI_SYSTEM_MD=<file>` replaces the CLI's prompt entirely. Measured: the
  request's `systemInstruction` was exactly Draggy's text.
- **Sessions on disk:** every session is written as `.jsonl` under
  `<GEMINI_CLI_HOME>/.gemini/tmp/<project>/chats`, conversation included. No setting turns this off
  (`general.sessionRetention` only prunes, with a one-day minimum), so Draggy deletes that folder
  when the chat is deleted and when the instance is removed.
- **`session/load`:** advertised, but it failed in the spike ("No previous sessions found for this
  project"), and the next process start deleted the earlier session's file. **Unverified**; until it
  works, a new process reseeds.
- **Seeding:** ACP has no way to add history. The CLI has `--session-file <json>` ("Load a session
  from a JSON file") at start, **untried**; otherwise a flattened transcript in the first prompt.

## 6. Sign-in: no clean route over ACP in 0.61.0

- ACP `authenticate { methodId: "oauth-personal" }` runs the CLI's normal sign-in. With no terminal
  it treats itself as headless and asks for consent by reading a line from stdin, which in ACP mode
  is the protocol stream (read from `authConsent.js` in the bundle, not triggered, to avoid opening
  a browser). It then opens the browser itself and waits on a `127.0.0.1:<port>/oauth2callback`
  listener of its own.
- With `NO_BROWSER=true`, measured: over ACP it writes "Please visit the following URL…" and "Enter
  the authorization code:" straight into stdout, the protocol stream, and consumed Draggy's next
  JSON-RPC line as the code. The URL is Google's (`accounts.google.com/o/oauth2/v2/auth`, the code
  shown on `codeassist.google.com/authcode`).
- Headless `-p` refuses outright: "Manual authorization is required but the current session is
  non-interactive."
- **Workable route, unverified:** a dedicated one-off `--acp` process used only for sign-in, whose
  stdin Draggy answers with raw lines (consent, then the pasted code) instead of JSON-RPC, after
  which the credentials cached in the private home serve every later session. It depends on
  undocumented interleaving and must be proven signed in (Phase 2b). **Question for the
  maintainer:** accept that, or wait for a CLI version with a protocol-level sign-in.
- Other auth methods offered: `gemini-api-key`, `vertex-ai`, `gateway`; never used for the account
  provider.

## 7. Environment

- Measured working with only `PATH`, `SystemRoot`, `TEMP`, `TMP`, `GEMINI_CLI_HOME`, and
  `HOME`/`USERPROFILE` pointed at the private folder. `GEMINI_CLI_HOME` is the documented variable
  that moves `~/.gemini`, so the user's own `oauth_creds.json` is never read.
- Set by Draggy: `GEMINI_SYSTEM_MD`. Never passed: `GEMINI_API_KEY`, `GOOGLE_API_KEY`,
  `GOOGLE_GEMINI_BASE_URL`, `GOOGLE_GENAI_USE_VERTEXAI`, `GOOGLE_CLOUD_PROJECT`,
  `GOOGLE_APPLICATION_CREDENTIALS`, proxy variables.
- Hosts a signed-in CLI uses, from its code (**unverified** by traffic): `accounts.google.com`
  (sign-in), `oauth2.googleapis.com` (tokens), `cloudcode-pa.googleapis.com` (the Code Assist API
  personal accounts go through).

## Phase 2b checklist (needs a signed-in Google account)

1. Sign in through the one-off process of §6; the cached credentials land in the private home and a
   later `--acp` session starts without asking.
2. A real turn with the settings above: the reply streams, Draggy's tools work, no CLI tool exists.
3. Quota and limit errors map to `account-limit-reached`; what status the CLI reports.
4. `session/load` after a clean process exit; or `--session-file` seeding.
5. Hosts contacted by a signed-in run (for the privacy policy), with usage statistics off.
6. Sign out (delete the private home's credentials) and that nothing outside it changed.
