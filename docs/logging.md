# Logging

Draggy writes three logs. Someone who has never seen the code should be able to open them, or a diagnostics zip a user sends, and find what failed, where and why.

## Where the files are

All three sit in `logs/` under the app's user data folder, 5 MB each with 3 rotations (`app.log.1` to `.3`).

| OS | Folder |
| --- | --- |
| Windows | `%APPDATA%\Draggy\logs` |
| macOS | `~/Library/Application Support/Draggy/logs` |
| Linux | `~/.config/Draggy/logs` |

| File | What it holds |
| --- | --- |
| `app.log` | Text, human-readable. INFO and above, long strings cut. The first place to look. |
| `debug.log` | Text, every level, nothing cut. Written only while verbose logging is on. |
| `events.jsonl` | One JSON object per line with the same events plus structured data. The Diagnostics page and `npm run logs` read this one. |

Settings → Diagnostics opens the folder, shows the live log and exports a zip. Native crash dumps land under `crashes/` in the user data folder and never leave the machine on their own.

## Line format

```
2026-10-09T18:56:16.726Z ERROR 8f3a.412 [3c1e...] [providers] request failed {"status":401,"upstreamId":"req_01"}
```

Timestamp, level, `<session>.<seq>`, correlation id (`[system]` when none), scope, a short lowercase message, then a data object. In `events.jsonl` the fields are `ts, seq, level, session, proc, pid, scope, msg, cid, durMs, data, err`.

## Levels

| Level | Use it for |
| --- | --- |
| ERROR | A failure the user notices or that loses work |
| WARN | Unexpected but recovered |
| INFO | A state change worth having in a bug report |
| DEBUG | Everything else. Per-chunk and per-frame events are DEBUG and rate-limited |

Log ids, counts, sizes, durations, status and the error `code`. For user content, log a hash or a length.

## Turning detail up

| How | Effect |
| --- | --- |
| Settings → Diagnostics → Verbose for 1 hour | DEBUG everywhere, or only the areas typed in the field. Turns itself off |
| Keep verbose logging | Survives a restart. Without it the level resets to INFO on the next boot |
| `DRAGGY_DEBUG=providers,mcp.github,ipc` | Raises those scopes to DEBUG in `app.log` |
| `DRAGGY_DEBUG=...` in `.env.local` | Same, in development only. The file is gitignored |
| `DRAGGY_LOG_DIR` | Where `npm run logs` reads from |

## Never logged

- Prompts, replies, file contents and stream chunks, at any level. They appear only as SHA-256 hashes or lengths.
- API keys, OAuth codes and tokens, in any form, not even hashed. A scrubber runs on every string, and every value the keystore holds is registered and dropped on sight.
- In the live logs, full paths stay because they help local debugging. The exported zip replaces the home folder with `~` and the user name with `<user>`.

## Summaries

- `turn summary` (scope `chat`, once per turn): model, prompt and output tokens, time to first token, tokens per second, tool calls, loops, duration.
- `session summary` (scope `lifecycle`, at quit): turns, errors by scope, five slowest IPC channels, peak memory, engine crashes.
- `startup` and quit timelines: one line each with the length of every step.
- Warning limits live in `electron/logThresholds.cjs`.

## Diagnostics zip

Settings → Diagnostics → Export shows the file list and sizes first. It holds `app.log` and rotations, `events.jsonl` (newest 20 MB), `system.json`, a short allowlist of settings, provider and MCP server types and status (no addresses, no keys), the large-model report and a `README.txt`. Debug-level lines and crash dumps are off unless ticked. Dumps are binary, so their paths cannot be replaced. The zip is built in the main process and saved only where the person picks.

## Scopes

A scope is `top.sub`. The top level comes from this list; do not add others.

| Top level | What it covers |
| --- | --- |
| boot | startup, session start and end |
| ipc | main-process IPC handlers |
| engine | llama.cpp, Ollama and other local runtimes |
| providers | cloud and local model API calls |
| mcp | MCP servers, one per server name |
| agent | chat turns, tools, context |
| files | file reads, writes, attachments |
| settings | settings and the keystore |
| updater | update checks and installs |
| window | windows, menus, tray |
| proc | child processes: spawns, exits, one-shot calls |
| lifecycle | crashes, hangs, startup and machine snapshot |
| quit | shutdown steps and timing |
| power | sleep, resume, display changes |
| net | proxy, offline, DNS |
| renderer | everything the renderer sends (prefix added by main) |
| logger | the logger itself |

## Correlation id

One id per chat turn. It is a UUID made in `src/agent/taskManager.ts` when the turn starts, carried as `correlationId` on `AgentRequest` and `ToolContext`, and written as `cid` on every line the turn produces.

| Hop | How the id travels |
|---|---|
| renderer log lines | `correlationId` on the log entry, stored as `cid` in `events.jsonl` |
| renderer → gateway (`draggy-ai://chat`) | `X-Request-Id` header, added by `loggedFetch` for that scheme only |
| gateway → built-in engine | same header, forwarded |
| gateway → remote provider | not sent. The provider's own id (`request-id`, `x-request-id`, `openai-request-id`, `anthropic-request-id`, `x-goog-request-id`) is logged as `upstreamId` |
| renderer → MCP call | optional last argument of `mcp:call`, then `options.cid` in `electron/mcp.cjs` |
| IPC wrapper | `ipcLog` reads `cid` / `correlationId` from the first argument |

Follow one turn: `npm run logs:turn <cid>`. Filters: `npm run logs -- --level warn --scope engine --since 10m`. Set `DRAGGY_LOG_DIR` or pass `--dir` to read a bundle.

Before an uncaught error, each process writes `recent events before failure`: its last 100 lines in one record. The renderer attaches the same list as `data.recent` to its own error lines.

## Runbook

These rows say where to look first. They have not yet been checked against a real reproduced failure each.

| Symptom | Where to look |
| --- | --- |
| App won't start | Previous `session-end` missing, `startup` timeline, `uncaughtException`, the log tail on the StartupScreen |
| Model won't load | `engine` launch line, stderr dump on exit, `reason` field, machine snapshot VRAM |
| Model loads but is slow | Tier plan line, GPU layers, `turn summary` tokens per second, `longtask` entries |
| Reply stops halfway | Stream end reason, `power` suspend, engine exit, provider rate-limit lines |
| Cloud provider errors | `providers` status and error code, `upstreamId` |
| MCP tool fails | `mcp.<name>` handshake, tool call `isError`, server stderr, OAuth steps |
| Download stuck or corrupt | Download progress lines, resume offset, checksum result, free disk |
| File action refused | `fsGuard` denial and the matched rule |
| UI frozen | `unresponsive` events, `longtask` entries, slow IPC warnings |
| Crash with no message | Dump path on next boot, `child-process-gone`, `render-process-gone` |
