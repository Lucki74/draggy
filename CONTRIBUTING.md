# Contributing to Draggy

Thanks for looking. Draggy is a small project with a specific point of view, so
this file is mostly about what that point of view is. The mechanics are short.

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

Typecheck, lint and the full test suite. There are around 1,900 tests and they
run in about six seconds, so there is no reason to skip them.

CI runs that same command on every push and pull request
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)), so a mistake will be
caught. It is caught faster on your own machine, though, and the suite takes
about six seconds. GitHub also scans the repository with CodeQL, which looks
for security issues rather than broken tests, and the release workflow fires
only on a version tag.

Tests run in a Node environment with no GPU and no Electron, which is why the
logic worth testing is kept away from the code that talks to hardware.
`src/voice/gate.ts` turns speech probabilities into conversation events and
knows nothing about audio; `electron/appData.cjs` decides whether to adopt a
data folder without touching one. Follow that shape and your change is testable.

## How the code is laid out

[Building and architecture](https://draggy.org/wiki/development) has the
folder layout and the two boundaries that matter most: `electron/preload.cjs`,
the only way from the renderer to the filesystem, network and database, and
the session split between Draggy's own window and any external page it opens.

Two checks sit behind the preload that the wiki page does not go into.
`electron/fsGuard.cjs` is the only way to a user's file: a new file tool
resolves its path there, or it is a way around it. And every tool declares
what it can do (`readOnly`, `destructive` and so on) so
`src/agent/permissions.ts` can decide whether to run it, ask, or refuse. A tool
without that declaration is treated as the most dangerous kind.

`electron/mainLoad.test.js` loads the whole main process against a fake Electron.
If you register a handler, add a module or move a block in `main.cjs`, that test
is what tells you the app still starts.

## House style

Match the file you are editing. Beyond that:

**Comments explain why, not what.** The code already says what it does. A
comment earns its place by recording the reason a decision went the way it did,
or the failure that made it necessary: the kind of thing the next person would
otherwise have to rediscover by breaking it.

**Two lines, and no more.** Every comment in the codebase fits in two lines of
at most twenty-five words each, including the module headers. The reason still
has to be in there; find the shorter way to say it.

**Name the tradeoff in the pull request.** If you picked a number (a
timeout, a threshold, a buffer size), say where it came from.

**No new dependency without a reason that survives being said out loud.**

Line endings are CRLF. There is no formatter; ESLint is the only automated style
check, and it covers `electron/` as well as `src/`.

## Translations

Draggy ships in twelve languages. The test suite enforces three things: every
language defines exactly the keys English does, every key the interface asks for
exists, and every key defined is actually used. A string added in English alone
fails CI, and so does one left behind by a feature that was removed.

If you cannot translate a string into all twelve, open an issue rather than
guessing with a machine translator. The register matters, and each language's
table keeps its own (`vous` in French, `du` in German, polite forms in Japanese
and Korean).

## Copyright and licensing

Draggy is licensed under the [GNU GPL v3.0 or later](LICENSE).

By opening a pull request you confirm two things:

1. The work is yours to give: you wrote it, or you have the right to submit it,
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
