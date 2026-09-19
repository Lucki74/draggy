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

You need Node 24 (what CI uses).

```bash
npm install
```

```bash
npm run electron:dev
```

That starts Vite and Electron together with hot reload.

## Before you open a pull request

```bash
npm run check
```

Typecheck, lint and the full test suite, around 1,960 tests in about six
seconds. CI runs the same command on every push and pull request, so a mistake
will be caught either way, faster on your own machine.

Tests run with no GPU and no Electron, so keep new logic testable by keeping it
away from hardware, the way `src/voice/gate.ts` and `electron/appData.cjs`
already do.

## How the code is laid out

[Building and architecture](https://draggy.org/wiki/development) has the
folder layout and the two boundaries that matter most: `electron/preload.cjs`,
the only way from the renderer to the filesystem, network and database, and
the session split between Draggy's own window and any external page it opens.

Behind the preload: `electron/fsGuard.cjs` is the only way to a user's file,
and every tool declares what it can do (`readOnly`, `destructive`, and so on)
so `src/agent/permissions.ts` knows whether to run it, ask, or refuse.

## Translations

Draggy ships in twelve languages, and CI enforces that every one defines
exactly the keys English does. If you cannot translate a string into all
twelve, open an issue rather than guessing with a machine translator: the
register matters (`vous` in French, `du` in German, and so on).

## Copyright and licensing

Draggy is licensed under the [GNU GPL v3.0 or later](LICENSE). By opening a
pull request you confirm the work is yours to give, and you license it under
the GPL v3.0 or later, and grant the maintainer the right to relicense the
project as a whole. Say so in the pull request if that does not sit right with
you, rather than merging something you did not agree to.

## Releases

Cutting a release is a tag away and maintainer-only. See
[RELEASING.md](RELEASING.md).
