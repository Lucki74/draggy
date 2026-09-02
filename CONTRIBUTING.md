# Contributing to Draggy

Thanks for looking. Draggy is a small project with a specific point of view, so
this file is mostly about what that point of view is — the mechanics are short.

## Open an issue first for anything large

Bug fixes, translation corrections and small improvements are welcome as pull
requests straight away. For a new feature, a new dependency, or anything that
changes how the app behaves on first launch, open an issue first. Draggy says no
to a lot of reasonable ideas on purpose, and it is better to find that out
before you have written the code than after.

Things Draggy deliberately does not do: phone home, collect analytics, require
an account, or send anything anywhere the user did not ask for. A change that
weakens any of those will be declined however well it is written.

## Getting it running

You need [Ollama](https://ollama.com) installed and running, and Node 24 (what
CI uses).

```bash
npm install
```

```bash
npm run electron:dev
```

That starts Vite and Electron together with hot reload. A GPU with 4 GB of VRAM
or more makes this pleasant; less works, with smaller models.

## Before you open a pull request

```bash
npm run check
```

Typecheck, lint and the full test suite. There are around 920 tests and they run
in about two seconds, so there is no reason to skip them.

CI runs that same command on every push and pull request
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)), so a mistake will be
caught — but it is caught faster on your own machine, and the suite takes
about two seconds. GitHub also scans the repository with CodeQL, which looks
for security issues rather than broken tests, and the release workflow fires
only on a version tag.

Tests run in a Node environment with no GPU and no Electron, which is why the
logic worth testing is kept away from the code that talks to hardware.
`src/voice/gate.ts` turns speech probabilities into conversation events and
knows nothing about audio; `electron/appData.cjs` decides whether to adopt a
data folder without touching one. Follow that shape and your change is testable.

## How the code is laid out

```
electron/     main process: windows, IPC, SQLite, search, the embedded
              browser, code execution, MCP servers, updates
src/          the React app
src/agent/    the streaming tool-calling loop, and conversation compaction
src/chat/     the message list and the rules for what can be attached
src/settings/ the settings panels
src/tools/    tool definitions and the registry they live in
src/voice/    capture, voice activity detection, turn-taking, speech
src/__tests__ everything that can be tested without a GPU
```

Two boundaries matter more than the rest:

`electron/preload.cjs` is the security boundary. The renderer has no Node access
and reaches the filesystem, the network and the database only through the
functions exposed there. Adding one is a deliberate act — say why in the pull
request.

The session split is the other. Draggy's own window runs under a strict Content
Security Policy; every external page runs on a separate partition with no policy
of ours imposed on it. Do not merge the two.

## House style

Match the file you are editing. Beyond that:

**Comments explain why, not what.** The code already says what it does. A
comment earns its place by recording the reason a decision went the way it did,
or the failure that made it necessary — the kind of thing the next person would
otherwise have to rediscover by breaking it.

**Two lines, and no more.** Every comment in the codebase fits in two lines of
at most twenty-five words each, including the module headers. The reason still
has to be in there; find the shorter way to say it.

**Name the tradeoff in the pull request.** If you picked a number — a timeout, a
threshold, a buffer size — say where it came from.

**No new dependency without a reason that survives being said out loud.**

Line endings are CRLF. There is no formatter; ESLint is the only automated style
check, and it covers `electron/` as well as `src/`.

## Translations

Draggy ships in twelve languages. The test suite enforces three things: every
language defines exactly the keys English does, every key the interface asks for
exists, and every key defined is actually used. A string added in English alone
fails CI, and so does one left behind by a feature that was removed.

If you cannot translate a string into all twelve, open an issue rather than
guessing with a machine translator — the register matters, and each language's
table keeps its own (`vous` in French, `du` in German, polite forms in Japanese
and Korean).

## Copyright and licensing

Draggy is licensed under the [GNU GPL v3.0 or later](LICENSE).

By opening a pull request you confirm two things:

1. The work is yours to give — you wrote it, or you have the right to submit it,
   and you are not bound by an employment or client agreement that says
   otherwise.
2. You license it under the GPL v3.0 or later, **and** you grant the maintainer
   a perpetual, worldwide, irrevocable right to use, modify and distribute it
   under other terms as well, including relicensing the project as a whole.

The second point exists so the project can change licence later without having
to track down every past contributor for permission. It does not take anything
away from you: your contribution stays yours, and it stays GPL for everyone
else. If you are not comfortable with it, say so in the pull request and we can
talk about it rather than merging something you did not agree to.

## Releases

Cutting a release is a tag away and maintainer-only. See
[RELEASING.md](RELEASING.md).
