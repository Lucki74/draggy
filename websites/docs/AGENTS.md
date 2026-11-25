# docs.draggy.org: agent guide

This is the documentation for Draggy, a free, open source (Apache 2.0) desktop app that runs models on the user's own computer. The app lives at the root of this repo (`../..`, app code in `../../app`) and the website at draggy.org in `../www`. This repo is public. Keep this file current when something below changes.

## Commands

| Command | What it does |
|---|---|
| `npm run build` | Builds every page in every language into `public/` (`build.mjs`), or into `DOCS_OUT` when that is set |
| `npm test` | Every `tools/*.test.mjs` file (`node --test`) |
| `npm run tokens:check` | Checks `docs.css` against the banned patterns, and its copy of the tokens against `../www/assets/css/site.css` (or `DRAGGY_SITE`) |

Run `npm run build` and `npm test` before you finish any task. To preview, serve `public/` on port 4174 (`python -m http.server 4174 -d public`). The workspace directory `temp` (at the root of `draggy`) is reserved for running tests and scratch outputs. Keep it clean after tests.

`npm test` runs `docs.test.mjs` (the built pages, links and language parity), `a11y.test.mjs` (axe-core, WCAG 2.2 AA, in en and ru, light and dark) and `layout.test.mjs` (no horizontal scroll at 320, 390, 768 and 1440px, 24px targets, heading order). The browser tests use the global Playwright and skip when it cannot be loaded.

## Layout

- `src/{en,fr,es,ru}/`: one Markdown file per page and language. English is served at `/`, the other languages at `/fr/`, `/es/` and `/ru/`.
- `nav.json`: the sidebar sections and page order. `site.json`: numbers shared across pages. `locales/`: the interface strings. `icons.json`: icon paths.
- Pages can use `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]` and `> [!IMPORTANT]` callouts, and a `> [!PLATFORMS]` block with one `- System: text` line per system for the Windows, macOS and Linux picker.
- `assets/css/docs.css`: the only stylesheet. The build cannot import from the website, so it keeps a copy of the design tokens and `npm run tokens:check` compares them.
- `assets/img/`: the screenshots, listed in `shots.json`.
- `vercel.json`: build settings and security headers. Do not loosen the CSP.

## Screenshots

Every screenshot comes from the real app; nothing is drawn, generated or mocked. `../../app/scripts/screenshots.cjs` takes them on a throwaway profile and writes them into `assets/img/` here (set `DRAGGY_SHOTS_OUT` when this checkout is not next to the app). A page shows one as `app-<name>-<theme>`, and other languages add the code, as in `app-talk-fr-dark`. The build falls back to the English file when a language has none.

- Capture both themes and every language where UI text shows, with a seeded demo project and no personal paths.
- After any app UI change, retake the affected shots and update `shots.json`.

## Writing rules

- Run every user-facing English string through the `humanizer` skill.
- Voice: plain, concrete, calm. Sentence case. No em dashes. No exclamation marks.
- Never say "offline". No benchmarks, no model-quality claims, and no numbers that weren't measured on the current release.
- Check every factual claim against the app at its current version. If you can't confirm it, cut it.
- Four languages with full parity. Write English first, then translate fr, es and ru from it. Match terms to the app's `../../app/src/translations.ts`.

## Git

- Commit messages are a subject line only, with no body and no attribution lines.
- Do not push or deploy unless asked. Vercel deploys from `main`.

## Subagents

- Spawn subagents only on the latest Haiku model (`model: "haiku"`).
- Spawn as few as the task needs.
