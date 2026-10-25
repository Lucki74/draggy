---
name: log-aggregation
description: Moves an app to structured logs with levels, request correlation ids and redaction, and sets up shipping to a central store with retention and cost limits. Use when the user asks to centralise logs, make logs searchable, add correlation ids, or cut noisy and expensive logging.
---

# Log aggregation

## Goal

Let someone answer "what happened to request X" across services in one search.

A good setup logs one JSON object per event, carries an id through every hop, never writes secrets, and has a retention policy.

## When to use

- Logs are scattered across hosts or only on stdout.
- Log lines are free text that cannot be filtered.
- A log bill or disk is growing without control.
- For alerts built on logs, use `use_skill` with `monitoring-alerts`.

## Steps

1. Find current logging with `search_files` for `console.log`, `logger`, `logging.` and `print(`, and note libraries in use with `read_file` on the dependency file.
2. Choose one logger per language and one JSON schema: timestamp in UTC, level, message, service, version, environment, request id, and error fields.
3. Edit the logger setup with `edit_file`. Write to stdout and let the platform ship it; avoid log files inside containers.
4. Add middleware that reads or creates a request id, puts it in the log context, returns it in a response header and forwards it on outbound calls.
5. Define levels: error means a person may need to act, warn means unexpected but handled, info is business events, debug is off in production.
6. Add redaction for passwords, tokens, authorization headers, card numbers and personal data. Search the code with `search_files` for places logging whole request bodies or objects.
7. Pick a shipping path suited to the platform (agent, sidecar, platform drain). Check current docs with `read_url` for the chosen tool's config.
8. Set retention by value: short for debug volume, longer for audit. Set sampling or drop rules for health check spam.
9. Estimate volume with `run_command` on a sample of real logs (lines per minute, bytes per line) before enabling a metered service.
10. Write the collector config with `create_file` and test locally by sending sample events.
11. Verify end to end: make one request, find its id in the store, and follow it across two services.
12. Add a short note on how to search, with three saved queries.

## Gotchas

- Logging full request or response objects leaks tokens and personal data into a store with wider access than the app.
- Local time stamps without a zone make cross-service ordering wrong. Use UTC with milliseconds.
- Multiline stack traces split into separate events unless the stack is one field in a JSON line.
- Debug logging left on in production is usually the biggest cost line.
- Request ids lost at queue or async boundaries break correlation exactly where it is needed.
- Cardinality matters: putting a user id into a metric label from a log pipeline can blow up the metrics bill.

## Output

- The logging config and middleware changes, listed by file.
- The log schema in one short table.
- Volume and retention assumptions, and the end to end test result.
