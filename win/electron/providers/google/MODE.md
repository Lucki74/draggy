# Antigravity CLI route (MODE.md)

Status: **NOT RUN.** Nobody signed in to Antigravity while this adapter was written. Every test runs
against recorded or hand-written `agy` output and a mock process. Do not call the route working
until the checklist below has been run by someone with an Antigravity account.

## Why this route exists

Google ended Gemini CLI access for AI Pro, Ultra and free personal accounts on 2026-06-18. Requests
from those accounts now come back 403. The Gemini API key provider is still the supported way to
use Gemini and is untouched. The Antigravity CLI (`agy`) is the one Google account route left, and
it is **off by default**.

## Terms warning

Google's Antigravity FAQ says headless mode is meant for direct scripting and CI, and that using
third-party software to reach Antigravity breaks its terms and can get the account suspended. Draggy
shows this before first use and does nothing until the user accepts. Whether Draggy's use counts is
Google's call, not ours.

## What the adapter does

- Finds `agy` through `DRAGGY_AGY_PATH` or the search path. It never installs it.
- Runs `agy --version` and `agy --help` once, and refuses a build whose help lacks `--output-format`
  and `stream-json`.
- One process per turn: `agy -p <prompt> --output-format stream-json --print-timeout 5m [--model <slug>]`.
- Reads the typed `init`, `step_update` and `result` events. Text comes from `agent_response`
  `text_delta`. Tool steps are counted and logged by name only.
- Never passes `--dangerously-skip-permissions`. If `init` reports a permission mode other than
  `request-review`, the turn is killed and refused.
- Non-zero exit with no `result`: the stderr text goes through the shared Google classifier
  (`failure.cjs`), which logs status, reason and message and names the failure.
- Draggy's own tools are not offered. `agy` has no MCP or ACP hook, so a chat on this route is text only.
- Never reads `~/.gemini/oauth_creds.json` or any other credential file. `agy` keeps its own login.

## Open assumptions (one constant each, swap if the run disagrees)

1. The prompt goes on the command line after `-p`. Not checked whether stdin works.
2. `agy models` prints one slug per line, slug first.
3. The `init` event carries `permission_mode`, and its default is `request-review`.
4. A failed `result` carries `error` as a string or a Google error object.

## Manual checklist: run these, then record the date and the output

- [ ] `agy --version` prints a version, and `agy --help` lists `--output-format` with `stream-json`.
- [ ] `agy -p "Reply with the single word ok." --output-format stream-json` prints NDJSON ending in a
      `result` event. Save one real capture as a test fixture.
- [ ] Settings, Providers, Google, Sign in: the terms warning shows first, declining changes nothing.
- [ ] Accepting with `agy` missing says it was not found and where to get it.
- [ ] Accepting with `agy` signed in ends as signed in after one short turn.
- [ ] A chat turn streams text and ends with token counts.
- [ ] Stop mid-turn kills the process (no `agy` left in Task Manager).
- [ ] A Pro account on the old route gets the named 403 message, not a generic one.
- [ ] `agy` signed out: the turn says to run `agy` in a terminal and sign in.
- [ ] `app.log` holds the status, reason and message for a failed turn, and no token or prompt text.
- [ ] Sign out in Draggy leaves `agy`'s own login alone.
- [ ] A user upgraded from the Gemini CLI route sees "sign in again through Antigravity".

Result: NOT RUN.
