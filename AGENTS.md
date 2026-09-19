# AGENTS.md

Notes for AI coding agents working in this repository. Local only: this file is
excluded from git and is not part of the published project.

Read [CONTRIBUTING.md](CONTRIBUTING.md) as well. It is the human-facing document
and its house style rules apply to you unchanged. This file covers what an agent
needs on top of that: the commands, the invariants that are enforced by tests,
and the traps that have actually cost time here.

## What Draggy is

A local-first Electron desktop assistant that runs an embedded native GGUF
engine (`llama-server`) with open models from Hugging Face. No account, no telemetry,
nothing leaves the machine that the user did not ask to send. A change that weakens any of that is
wrong however well it is written, so do not propose one.

Electron main process in `electron/` (CommonJS, `.cjs`), React renderer in
`src/` (TypeScript). `electron/main.cjs` is the entry point.

## Commands

```bash
npm run check
```

Typecheck, lint and the full suite: around 1,900 tests in a few seconds. Run it
before you claim anything is done. CI runs the same command on Node 24.

```bash
npm run electron:dev
```

Vite and Electron together with hot reload. Port 5173; a stale Vite process from
a previous run will hold it and the next launch fails with `Port 5173 is already
in use`. Kill it before retrying.

```bash
npm run electron:build
```

Builds the NSIS installer into `dist-electron/`. On a network with TLS
interception this fails with `unable to verify the first certificate`; the fix
is `$env:NODE_OPTIONS="--use-system-ca"` before the command. CI is unaffected.

## Two kinds of test

Most of the suite is pure logic in plain Node. Component tests carry a
`// @vitest-environment jsdom` docblock of their own, render with
`@testing-library/react`, and get a fake preload from
`src/__tests__/helpers/electronApi.ts`. Reach for one whenever the thing that
can break is wiring rather than a calculation: both the 1.2.2 and 1.2.3 bugs
were invisible to every logic test in the repo.

A fake subscription must return a **function**. React calls whatever an effect
returns, so handing back a promise or a boolean fails with the unhelpful
`destroy is not a function`.

## The two boundaries

**`electron/preload.cjs` is the security boundary.** The renderer has no Node
access and reaches the filesystem, network and database only through what is
exposed there. Adding a function is a deliberate act, not a convenience.

**The session split.** Draggy's own window runs under a strict CSP on
`defaultSession`; every external page runs on the `persist:draggy-web`
partition with no policy of ours imposed on it. Never merge the two, and never
relax the app's CSP to make something in the renderer work.

## Invariants with a test watching them

Each of these exists because it broke once. The guard test is the record.

**Every child process goes through `platform.spawnHidden` or
`platform.execFileHidden`.** A packaged Draggy is a GUI binary with no console,
so a bare `spawn` of a console program gets a new visible window and flashes it
at the user. `electron/spawning.test.js` scans `electron/*.cjs` for raw
`spawn`/`execFile` calls and fails on any it finds. The helpers spread the
caller's options *first* so `windowsHide` cannot be overridden.

Related: never launch an npm package through `npx` at runtime. `npx` runs a
package via a `cmd.exe` shim, which is exactly the console window above. MCP
servers are installed once with npm into the user data folder and their entry
point is run directly with `ELECTRON_RUN_AS_NODE`. Node also refuses to spawn
`.cmd` files at all since CVE-2024-27980, so `resolveNpx`/`resolveNpm` in
`platform.cjs` resolve the `-cli.js` instead.

**A preload channel may have many listeners.** `subscribe` returns a disposer
that removes one listener; there are no blanket `offState`/`offProgress`
functions, because either subscriber calling one silences the other. This is not
theoretical. It silently killed the Settings update panel in 1.2.2.
`electron/preload.test.js` guards it.

**Twelve languages stay in parity.** `src/__tests__/translations.test.ts`
enforces that every language defines exactly the keys English does, that every
key the interface calls for exists, and that every key defined is still used. A
string added in English alone fails CI, and so does one orphaned by a removed
feature. Do not machine-translate: each table keeps its own register (`vous` in
French, `du` in German, polite forms in Japanese and Korean).

**Outbound URLs go through `electron/urlPolicy.cjs`.** `http:`/`https:` only,
private hostnames refused. Anything that fetches on the model's behalf uses it.

**Diagnostics protect privacy with dual-file rotation and hashing.** Operational
events write to `app.log` while verbose traces land in `debug.log`. Sensitive
payloads (`prompt`, `content`, `text`, `rawChunk`, etc.) are hashed with SHA-256
and truncated before writing to disk. `src/__tests__/logger.test.ts` guards it.

**Model repetition loops are halted.** Degenerate token loops (such as repeated
safety refusal markers like `== [REDACTED] ==` or repeating lines and phrases) are
detected in real time by `src/agent/repetition.ts`. The streaming loop aborts
before runaway output wastes compute, and trims the repetitive tail before saving.
`src/__tests__/repetition.test.ts` and `src/__tests__/agentLoop.test.ts` guard it.

## House style, in short

Match the file you are editing. Then:

- Comments explain **why**, never what. Two lines maximum, twenty-five words per
  line maximum, module headers included.
- **Every comment is two lines long at most, with no exceptions.** Any syntax is
  fine (`//`, `/* */`, `/** */`, `{/* */}` in JSX), but the lines the delimiters sit
  on count: a `/**` on its own line plus text plus ` */` is already three. A long
  JSDoc block becomes `/** one line */`, or two lines with the delimiters sharing
  them. If the reason does not fit in two lines, it belongs in the wiki or the chat
  reply, not the code. The only files exempt are verbatim copies of old releases
  under `electron/fixtures/`, which have to stay byte-identical to mean anything.
- Line endings are CRLF. There is no formatter; ESLint is the only automated
  check and it covers `electron/` as well as `src/`.
- No new dependency without a reason that survives being said out loud.
- Keep logic testable by keeping it away from hardware. `src/voice/gate.ts`
  turns speech probabilities into events and knows nothing about audio;
  `electron/appData.cjs` decides whether to adopt a folder without touching one.
  Tests run in Node with no GPU and no Electron.

## Commit messages are one line

**The subject line, and nothing else.** No body, no paragraphs explaining the
reasoning, no summary of what was tried. The maintainer has asked for this
directly: the long write-ups were noise in `git log`.

```
Stop the composer showing under the settings page
```

No trailer either. `attribution.commit` is set to `""` in
`~/.claude/settings.json`, so the `Co-Authored-By` line is gone; if you find
yourself about to add one by hand, do not. Detail that seems worth keeping goes
in the chat reply, a comment in the code, or the wiki, never the commit.

## Verification is the job

The bar here is evidence, not plausibility. Specifically:

- **A guard test must be shown to fail.** Inject the regression it is meant to
  catch, watch it go red, then restore. A guard written against code that
  already passes has caught nothing and may be asserting on a string that does
  not exist.
- **Test the real thing, not a proxy.** Console-window behaviour measured from a
  shell that already has a console tells you nothing, because children inherit
  it. Measure from a GUI process, the way the packaged app runs.
- **Say what you did not verify.** The updater is disabled in dev builds
  (`app.isPackaged` is false), so updater behaviour cannot be exercised by
  `electron:dev`. If you proved it with a unit test instead, say so.
- Report counts and outcomes as they are. If tests fail, show the output.

## Releases

Maintainer-driven and tag-triggered. Full detail in
[RELEASING.md](RELEASING.md). From a clean `main`: `npm run check`, then
`npm version patch`, then `git push --follow-tags`. The tag starts
`.github/workflows/release.yml`, which builds on Windows, macOS and Linux and publishes
the installers plus the `latest.yml` the in-app updater reads.

**A prerelease version works, but only upward.** `detectUpdateChannel: false`
keeps every build in `latest.yml`, and the updater sets `allowPrerelease` with
the channel pinned, so `1.2.6-fix` is a normal release. What no setting fixes is
ordering: semver puts a prerelease below the version it is tagged from, so
`1.2.6-fix` is newer than `1.2.5` while `1.2.5-fix` is **older** than `1.2.5`
and reaches nobody already on it. Tag from the version you are heading for.

Do not commit, push, tag or release unless asked. The version in `package.json`
is the single source of truth; a tag that disagrees with it is never offered to
anyone.

## The website is not in this repository

The site that advertises Draggy sits beside it, in `../draggy-website`, and is
published at draggy.org. It is its own folder, not a git repository, and
nothing here builds, tests or deploys it, so a change in this repo cannot
break it.

The site is generated: `npm run build` there writes 240 pages (3 pages plus
17 wiki pages in each of the twelve languages this app speaks), from templates
and one JSON file per language. They land in `public/`, which is wiped on every
build and is the whole of what Vercel serves. Three things are duplicated between
the two projects rather than shared, and each one goes stale silently:

- **The palette.** `assets/css/site.css` transcribes the custom properties from
  `src/index.css`. Change a colour here and the site keeps the old one.
- **The app icon.** `assets/img/draggy-icon.png` and the favicon are copies of
  `build/icons/`.
- **The icon sprite.** The site installs its own `lucide-react` and builds the
  sprite with `npm run icons`, so it draws the icons the interface draws. That
  copy is pinned to an exact version rather than a caret range, because the
  range resolved two dozen minor versions ahead and quietly changed three
  icons. Moving `lucide-react` here means moving it there and regenerating.

**The list of languages is duplicated too.** `src/translations.ts` has twelve
locales and the site has the same twelve, in `tools/locales`. Adding a
thirteenth to the app does not add it to the site.

The pictures of the interface are screen captures of the app actually running,
not drawings, so any visible change to the interface dates them.
`../draggy-website/README.md` records how they were taken and the three traps
that cost time doing it.

## Environment notes

Windows 11, PowerShell and Git Bash both available. Two things that have gone
wrong before:

- **Bash heredocs eat a level of backslash escaping.** Writing files containing
  `\n` through a heredoc has silently corrupted source and test files here. Use
  the editing tools, or write a Python script to a file and run that.
- **PowerShell unrolls an empty collection to `$null`.** A script that diffs
  process or window sets needs a hashtable, not a bare `HashSet`, or the empty
  baseline case returns nothing and the comparison looks like success.
- **Node 25 has its own `localStorage` global** and it shadows the one jsdom
  installs, so every call fails with `setItem is not a function`.
  `src/__tests__/helpers/setup.ts` replaces it, along with the handful of
  browser APIs jsdom leaves out.
- **`concurrently -k` tree-kills**, so `npm run electron:dev` cannot be used to
  test what survives a quit. Build first and launch
  `node_modules/electron/dist/electron.exe .` detached with
  `DRAGGY_RENDERER=dist`.
