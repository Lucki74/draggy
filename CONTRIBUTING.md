# Contributing to Draggy

Thanks for looking. Draggy is a small project with a specific point of view, so this file is mostly about what that point of view is.

## Open an issue first for anything large

Bug fixes, translation corrections, and small improvements are welcome as pull requests straight away. For a new feature, a new dependency, or anything that changes how the app behaves on first launch, open an issue first. Draggy says no to a lot of reasonable ideas on purpose, and it is better to find that out before you write the code.

Things Draggy deliberately does not do: phone home, collect analytics, require an account, or send anything anywhere the user did not ask for. Any change weakening those guarantees will be declined.

## Getting it running

You need Node 24 (matching CI). Run every command below from `win/`.

```bash
cd win
npm install
```

```bash
npm run electron:dev
```

That starts Vite and Electron together with hot reload on port 5173.

## Before you open a pull request

```bash
npm run check
```

Typecheck, lint, and run the test suite: roughly 3,000 tests in fifteen seconds. CI runs the same command for every pull request, and pull requests are squash merged.

Tests run with no GPU and no Electron, so keep new logic testable by keeping it isolated from hardware, the way `src/voice/gate.ts` and `electron/appData.cjs` do.

## Architecture and code boundaries

The [wiki](https://draggy.org/wiki/development) describes the folder layout and the two boundaries that matter most:

- `electron/preload.cjs` is the only bridge from the renderer to the filesystem, network, and database.
- The session split: Draggy's own window runs under strict CSP on `defaultSession`, while external web pages run in the `persist:draggy-web` partition. Never merge the two or loosen the application CSP.

All child processes must run through `platform.spawnHidden` or `platform.execFileHidden`. Never use `npx` at runtime.

Pictures come from stable-diffusion.cpp's `sd-server`, a hidden child process on `127.0.0.1` (`electron/sdServer.cjs`, installed by `electron/sdBinaryManager.cjs`). Its tests run against a fake server started as a real child process, so they need no binary and no GPU. Keep it that way.

Models too large for memory run on colibri, a second engine managed by `electron/colibriProcess.cjs` and installed by `electron/colibriBinary.cjs`. Its tests also use fakes (a stub gateway process, recorded hardware output in `electron/fixtures/hardware/`), so they need no engine, no GPU and no big download. Only one local engine runs at a time (`electron/engineHost.cjs`). The user-facing side is described on the wiki at [draggy.org/wiki](https://draggy.org/wiki).

## House style

- Match the file you are editing.
- Line endings are CRLF. ESLint is the automated checker.
- Avoid new dependencies unless strictly necessary.

## Translations

Draggy supports four languages: English, French, Spanish, and Russian. CI enforces that every language defines exactly the keys English does. Do not use machine translation; each table maintains its own register (`vous` in French, `tú` in Spanish, `вы` in Russian).

## Copyright and licensing

Draggy is licensed under the [Apache License 2.0](LICENSE). By contributing, you agree that your contributions are licensed under Apache 2.0 and will retain the [NOTICE](NOTICE) file that credits Draggy.

## Releases

A build is cut by the maintainer from the Release workflow. See [RELEASING.md](RELEASING.md).
