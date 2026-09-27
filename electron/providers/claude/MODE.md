# Claude spike results (MODE.md)

Pinned: **Claude Code 2.1.274** (the `stable` channel on 2026-09-27; `latest` was 2.1.283). Spike
run on 2026-09-27, Windows 11 x64. Everything below was measured against the pinned binary unless
marked **unverified**. No Claude account was signed in: every turn ran against a local mock of the
Anthropic Messages API (`ANTHROPIC_BASE_URL` plus a dummy key, set for the spike's mock only; Draggy
itself never passes either, hard rule 13), which records exactly what Claude Code sends to the
model. What only a signed-in account can show is listed at the end, for the Phase 2b checklist.

## 1. Terms (§4.7.1)

The maintainer confirmed on **2026-09-26** that Anthropic's terms, changed recently, do not
prohibit a third-party app from offering Claude Pro/Max sign-in through the official Claude Code
runtime. Not re-checked, by instruction.

## 2. Version, licence and download

- **Licence:** the package's `LICENSE.md` reads "© Anthropic PBC. All rights reserved. Use is
  subject to the Legal Agreements…". No redistribution grant, so Draggy **does not bundle** it:
  it downloads the binary on first sign-in.
- **Download:** `https://downloads.claude.ai/claude-code-releases/<version>/<platform>/claude[.exe]`,
  with `https://downloads.claude.ai/claude-code-releases/<version>/manifest.json` giving each
  platform's SHA-256 and size (`darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`,
  `linux-arm64-musl`, `linux-x64-musl`, `win32-x64`, `win32-arm64`). `…/stable` returns the stable
  version number. Win32-x64 2.1.274: 233,691,808 bytes,
  `4e4c1746aff835bb05e5ed14cda72d21ee6fbda4147aa99b3135718614da117e`; the npm-installed binary
  matched it. Draggy ships these checksums itself rather than trusting the manifest at run time.
- **Driver: the binary's own stream-json over stdio (option 2).** The Agent SDK
  (`@anthropic-ai/claude-agent-sdk` 0.3.274) carries the same "All rights reserved" licence, and it
  is only a client of this protocol: every SDK feature Draggy needs is a flag or a control message
  the binary accepts directly (below). No new dependency.
- Launch: `claude -p --input-format stream-json --output-format stream-json --verbose
  --include-partial-messages` plus the flags in §3. A live process takes one user message per
  line on stdin and answers each with a `result`, so one process serves a whole conversation.
  Startup takes about 3 s on this machine.

## 3. Stripping every built-in (hard rule 12): possible in 2.1.274

Measured by the `tools` array and system prompt Claude Code sent to the mock, and by the `init`
message it prints.

**Default:** 27 built-in tools (`Agent`, `Bash`, `PowerShell`, `Read`, `Edit`, `Write`, `Glob`,
`Grep`, `NotebookEdit`, `WebFetch`, `WebSearch`, `Skill`, `Workflow`, `Monitor`, `SendMessage`,
`ListAgents`, `TaskOutput`, `TaskStop`, `CronCreate`, `CronDelete`, `CronList`, `ScheduleWakeup`,
`PushNotification`, `ReportFindings`, `DesignSync`, `EnterWorktree`, `ExitWorktree`), 17 skills,
5 agents, 49 slash commands, and a 9,095-character system prompt.

**Stripped:** the model sees only Draggy's tools. Flags:

```
--tools ""                      empties the built-in set (the SDK's `tools: []` passes exactly this)
--setting-sources ""            no user, project or local settings files
--strict-mcp-config             only the MCP servers given below
--mcp-config '{"mcpServers":{"draggy":{"type":"sdk","name":"draggy"}}}'
--disable-slash-commands        no skills
--permission-prompt-tool stdio  every permission question comes to Draggy as `can_use_tool`
--system-prompt <Draggy's prompt>
```

Measured: `tools: ["mcp__draggy__read_file"]`, no skills, no slash commands. The 5 agents are
still listed in `init`, but without the `Agent` tool nothing can start one.

**Backstop, measured:** when the mock made the model call `Bash`, Claude Code did not run it and did
not ask: it answered the model itself with "No such tool available: Bash. Bash is disabled for this
session". Draggy's own backstop stays: `can_use_tool` for any name not starting with
`mcp__draggy__` is denied, logged, followed by an interrupt and `provider-unknown-error`.
`--permission-mode bypassPermissions` and `--dangerously-skip-permissions` are never passed.

**Re-proving it:** `node scripts/claude-probe.cjs <claude binary>` runs one turn with these flags
against a mock, where the model first calls `Bash`, and fails unless only Draggy's tool is listed,
Draggy's prompt arrives and the `Bash` call is refused unrun. On 2.1.274 all five checks pass.
Shown failing: with `--tools default`, three checks fail, and the injected `Bash` call ran without
being asked. Run it on every bump, since a tool new in that version must be proven absent.

**What the runtime still adds, and cannot be removed with a custom prompt:**
- Two system blocks before Draggy's prompt: a billing header line
  (`x-anthropic-billing-header: cc_version=2.1.274…; cc_entrypoint=sdk-cli;`) and the line
  "You are a Claude agent, built on Anthropic's Claude Agent SDK." Draggy's prompt follows intact.
- An environment message in the conversation: working directory, platform, OS version, date. The
  working directory is the private folder, whose path contains the Windows user name. **Question
  for the maintainer:** choose a working directory without the user name, or accept it.
- Occasionally a `<total_tokens>… tokens left</total_tokens>` system message.

## 4. Tools mode: in-process MCP over the control channel

Draggy's tools are an SDK-type MCP server that Draggy itself answers; no second process.

- `initialize` control request: `{ subtype: "initialize", sdkMcpServers: ["draggy"],
  sdkMcpServerConfigs: { draggy: { timeout } }, title: "Draggy" }`.
- Claude Code then sends `control_request { subtype: "mcp_message", server_name: "draggy",
  message: <JSON-RPC> }` for `initialize`, `notifications/initialized`, `tools/list` and
  `tools/call`; Draggy answers `control_response { response: { mcp_response: <JSON-RPC> } }`.
- Measured round trip: model `tool_use` → `can_use_tool { tool_name: "mcp__draggy__read_file" }`
  (Draggy answers `{ behavior: "allow", updatedInput }`) → `mcp_message tools/call` → Draggy's
  result → the next model request carries the `tool_result`, with the thinking block and its
  signature kept. The adapter holds the `tools/call` open until the gateway request with the
  result arrives, as Codex mode A does.
- **Pending call timeout:** answers after 150 s were accepted with and without
  `sdkMcpServerConfigs.draggy.timeout`, and after 10 minutes with the timeout set to 24 h: the turn
  completed with the result in the next request. The timeout is a hard wall-clock
  limit per call; Draggy sets it far above any approval wait.
- **Stop while a call is pending:** the `interrupt` control request (§5).

## 5. Turns

- **Streaming** (`--include-partial-messages`): `stream_event` carries the Messages API events;
  `content_block_delta` `text_delta` → `delta.content`, `thinking_delta` →
  `delta.reasoning_content`; `result` (`subtype: "success"`, `usage`) → finish.
  `message_delta.stop_reason: "max_tokens"` → `finish_reason: "length"`.
- **Interrupt:** `control_request { subtype: "interrupt" }`. Measured: the upstream HTTP request
  closed 1 ms after the interrupt was written; the turn ends with
  `result.subtype: "error_during_execution"`, which the adapter reports as a stop.
- **System prompt:** `--system-prompt` is accepted (see §3 for what is still prepended).
- **Title request:** without a title, Claude Code sends the conversation to the model a second time
  to name the session. `initialize.title` set: measured, no title request.
- **Thinking:** requests carried `thinking: { type: "adaptive" }`; flags `--thinking
  adaptive|disabled`, `--max-thinking-tokens <n>`, `--effort low|medium|high|xhigh|max`, and the
  `set_max_thinking_tokens` control request. Map the pill to `--effort`. Not exercised against a
  real model.
- **Images:** a user message's content may hold `{ type: "image", source: { type: "base64",
  media_type, data } }` blocks; measured, they reach the model request unchanged.
- **Models:** the `initialize` response lists `default`, `opus[1m]`, `sonnet`, `sonnet[1m]`,
  `haiku`; `--model` takes an alias or a full name.
- **Usage:** the `get_usage` control request (`skip_behaviors: true`) answers with session cost and
  token totals; its plan rate-limit section needs a signed-in plan (**unverified**).

## 6. Sessions, seeding and rewind (§4.7.4)

- **One process per conversation** keeps the session in memory across turns.
- **Resume after the process stops:** `--session-id <uuid>` on the first run, `--resume <uuid>`
  later. Measured: the new process sent the earlier exchange as proper history. This needs session
  persistence, which writes the conversation as plain-text `.jsonl` under
  `<CLAUDE_CONFIG_DIR>/projects/`. `--no-session-persistence` writes nothing, but then a stopped
  process means a reseed. **Question for the maintainer:** persist (deleted with the chat) or not.
- **Rewind for edit and regenerate:** `--resume <id> --resume-session-at=<assistant uuid>
  --fork-session`. Measured: the request carried only the history up to that reply plus the new
  message, under a new session id. So an edit or a regenerate needs no reseed.
- **Seeding a new session with a transcript:** no structured way over stdin. An `assistant`
  message on stdin is accepted, but `shouldQuery: false` user messages are held back and merged into
  the next querying message, so "user, assistant, user" arrives as "assistant, user+user". The
  seed is therefore a flattened transcript in the first user message, costing one prompt of the
  transcript's length (**not measured against plan quota**).

## 7. Sign-in (§4.7.3): route 1 works without a terminal, through the protocol

- `control_request { subtype: "claude_authenticate", loginWithClaudeAi: true }` starts the OAuth
  flow with the browser opening skipped, and answers `{ manualUrl, automaticUrl }`. Both authorize
  on `https://claude.com/cai/oauth/authorize`; `automaticUrl` returns to Claude Code's own
  `localhost:<port>/callback`, `manualUrl` to `https://platform.claude.com/oauth/code/callback`,
  which shows a code. Draggy opens one with `shell.openExternal`; a pasted code goes back with
  `claude_oauth_callback { authorizationCode, state }`, and `claude_oauth_wait_for_completion`
  resolves when the runtime has stored its credentials. Only Anthropic's servers are involved.
- The CLI route (`claude auth login --claudeai` with stdio piped) also works without a TTY: it
  prints the URL and reads the code from stdin. But it **opens the default browser by itself**
  (it did during the spike; the tab was left unused), so Draggy uses the protocol route.
- `claude auth status --json` → `{ loggedIn, authMethod, apiProvider, … }`; `claude auth logout`.
- **Where the tokens go:** `<CLAUDE_CONFIG_DIR>/.credentials.json` on Windows and Linux. On macOS
  the Keychain, under the service `Claude Code…-credentials` with `-<first 8 hex of
  sha256(CLAUDE_CONFIG_DIR)>` appended whenever `CLAUDE_CONFIG_DIR` is set (read from the binary),
  so Draggy's entry is its own and the user's Claude Code entry is never read, provided
  `CLAUDE_SECURESTORAGE_CONFIG_DIR` is not in the child environment. Route 2 (a pasted
  `setup-token`) is not needed.
- `--bare` is not usable: it never reads OAuth credentials.

## 8. Environment

- Measured working with only `PATH`, `SystemRoot`, `TEMP`, `TMP`, `CLAUDE_CONFIG_DIR`, and
  `USERPROFILE`/`HOME` pointed at the private folder.
- Set by Draggy: `DISABLE_TELEMETRY=1`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`,
  `DISABLE_ERROR_REPORTING=1`, `DISABLE_AUTOUPDATER=1`. Measured: `initialize` reports
  `analytics_disabled: true` with them, `false` without.
- Never passed: `ANTHROPIC_*`, `CLAUDE_CODE_USE_*`, `CLAUDE_CODE_OAUTH_TOKEN`,
  `CLAUDE_SECURESTORAGE_CONFIG_DIR`, proxy variables.
- Claude Code sends `HEAD /api/hello` to its API host at start.

## Phase 2b checklist (needs a signed-in Pro or Max account)

1. Sign in through `claude_authenticate` with both URLs; `auth status` shows the plan.
2. A real turn with the stripped flags: the reply streams, Draggy's tools work, and the model never
   sees a Claude Code tool.
3. `--system-prompt` is accepted on a subscription sign-in (the runtime may require its preset).
4. `get_usage` shows plan rate limits; the limit-reached error and its reset time.
5. `--resume` and `--resume-session-at` on a real session.
6. macOS: the Keychain entry name has the config-dir suffix, and the user's own entry is untouched.
7. Hosts contacted by a signed-in run, with the telemetry variables set (for the privacy policy).
8. Sign out, and that the private folder's credentials are gone.
