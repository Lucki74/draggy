# Draggy AI agent instructions

## Development and test workflow

- Run `npm run check` (typecheck, lint, and tests) before finishing any task.
- Run targeted tests during iteration: `npx vitest run src/__tests__/<file>.test.ts` (or `-t "test name"`). Avoid running the full suite repeatedly in short loops.
- Run tests via the `test-runner` subagent (`claude-haiku-5-5`) when you want to keep long failure traces out of the main context.
- Development server: `npm run electron:dev` (runs on port 5173; terminate any stale Vite processes if the port is in use).

## Architectural invariants enforced by tests

1. Process execution:
   All child processes must use `platform.spawnHidden` or `platform.execFileHidden` (`electron/spawning.test.js`). Packaged Draggy runs without a console window. Do not launch via `npx` (CVE-2024-27980 and console flashing). Run MCP entry points with `ELECTRON_RUN_AS_NODE`.

2. Preload boundary:
   `electron/preload.cjs` is the only path from the renderer to Node. Subscriptions in tests must return a cleanup function rather than a promise or boolean.

3. Session and CSP split:
   The main window runs on `defaultSession` under a strict CSP. External web pages load on `persist:draggy-web`. Do not merge sessions or loosen the main CSP.

4. Language parity:
   `src/__tests__/translations.test.ts` requires complete key parity across all four supported languages: English, French, Spanish, and Chinese. Adding an English key requires matching entries in the other three.

5. Single instance:
   `electron/main.cjs` claims `app.requestSingleInstanceLock()`. Closing the main window exits the process.

6. Diagnostics and privacy:
   Sensitive payloads write to disk only as SHA-256 hashes. Streaming chunks are recorded by token count and byte length only.
   Keys, OAuth codes and tokens never reach disk, not even hashed.
7. Logging:
   Register IPC handlers through `electron/ipcLog.cjs`. Log through `electron/logger.cjs` with a dotted scope that follows the ones already in use. No `console.*` and no raw `fetch` in `src/` outside the allowlist. Every catch logs through `log.swallow` / `logSwallow` or returns a value; the baseline is in `src/__tests__/silentCatches.test.ts`. Messages are short lowercase phrases plus a data object.

See [AGENTS.md](AGENTS.md) for full context, test guidelines, and house style.

## Compact instructions

When compacting, keep test output, changed file paths and open decisions.

## Cloud sessions

The cloud VM is Linux with no display. Run only `npm run typecheck`, `npm run lint` and `npm test` (or `npm run check`). Do not run `electron:dev` or any electron-builder target.
