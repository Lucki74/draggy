# draggy.org: agent guide

This is the website for Draggy, a free, open source (Apache 2.0) desktop app that runs models on the user's own computer. The app lives at the root of this repo (`../..`, app code in `../../app`) and the documentation at docs.draggy.org in `../docs`. This repo is public. Keep this file current when something below changes.

## Commands

| Command | What it does |
|---|---|
| `npm run build` | Builds every page in every language into `public/` (`tools/build.mjs`) |
| `npm test` | Every `tools/*.test.mjs` file (`node --test`) |
| `npm run i18n` | Checks key parity across en, fr, es and ru |
| `npm run tokens:check` | Checks the CSS against the design tokens and banned patterns |
| `npm run images` | Builds and checks the images listed in `assets/img/shots.json` |
| `npm run icons` | Rebuilds `assets/img/icons.svg` |
| `npm run counts` | Writes the app's counts (MCP servers, skills, skills on) into `site.config.json` |
| `npm run release` | Fetches the current release data into `release.json` |

Run `npm run build` and `npm test` before you finish any task. To preview, serve `public/` on port 4173 (`scratch/serve.mjs`, or `python -m http.server 4173 -d public`). The workspace directory `temp` (at the root of `draggy`) is reserved for running tests and scratch outputs. Keep it clean after tests.

`npm test` runs `middleware.test.mjs` (language routing and headers), `site.test.mjs` (the built output), `frontend.test.mjs` (the client script), `css.test.mjs` (the stylesheets and markup), `release.test.mjs` (the release data), `counts.test.mjs` (the app counts), `content.test.mjs` (broken characters and redirects), `a11y.test.mjs` (axe-core, WCAG 2.2 AA, on key pages in en and ru, light and dark) and `layout.test.mjs` (no horizontal scroll at 320, 390 and 1440px, 24px targets, heading order). The checks that read the app repo skip when it is not there. They use `DRAGGY_APP` when that is set, and `../..` otherwise. The browser tests use the global Playwright and skip when it cannot be loaded.

## Layout

- `tools/pages/*.html`: one `<main>` per page. `build.mjs` writes the head, header, language menu and footer around it once. Besides the home and download pages there are `open-source`, `models` (licenses read from each model's Hugging Face page; re-check them when the app's model list changes), `compare` (every competitor cell is sourced in `docs/overhaul/compare-sources.md`; re-check them when you touch the page), `pricing` (free for all, any later cloud feature billed), `accessibility`, the privacy policy, the error index and the 404 page.
- `tools/locales/{en,fr,es,ru}.json`: every string, one file per language, loaded by `tools/locales.mjs`. There are no part files. English is served at `/`, the other languages at `/fr/`, `/es/` and `/ru/`. There is no `/en/`: `/en` and `/en/` redirect to `/`.
- `tools/policy/`, `tools/errors/`: the privacy policy and error pages, one file per language.
- The documentation at docs.draggy.org lives in `../docs`. `/wiki` on draggy.org redirects there.
- `assets/css/`: `site.css` (tokens, header, footer, shared parts) plus one file per page type, `home.css`, and `pages.css` (download, 404, errors). `build.mjs` links `site.css` and the one that matches the page.
- `assets/js/site.js`, `assets/fonts`, `assets/img`, `assets/clips`.
- `site.config.json`: `starsMin`, and the counts shown on the site (`mcp`, `skills`, `skillsOn`). `tools/counts.mjs` reads the counts from the app repo when it is beside this one. The build fails if they differ from this file, and `npm run counts` writes the new numbers.
- `release.json`: the release data. `.github/workflows/release-data.yml` refreshes it every hour, and again when a `repository_dispatch` of type `release` arrives. The app's release workflow does not send one yet, so the hourly run is what refreshes it. It commits the file only when it changed.
- `/.well-known/security.txt` is written by the build. Its Expires date is the build day plus 364 days, so each deploy renews it.
- `middleware.js` and `vercel.json`: language routing, redirects and security headers (CSP, HSTS, frame-ancestors). Do not loosen the CSP.
- `docs/overhaul/`: the overhaul work. `PLAN.md` is the checklist: tick items with `[x]` as you finish them, and add `(dropped: reason)` when an item is cut. `facts.md` records what the app does, checked against its source, and copy must agree with it. `research/` holds the audits behind the plan.

## Screenshots and clips

Every image and clip comes from the real app; nothing is drawn, generated or mocked. A clip is used on a page as `{{clip:<name>|<alt key>|<caption key>}}` and needs these files in `assets/clips/`:
- `<name>-light.{webm,mp4,jpg}` and `<name>-dark.{webm,mp4,jpg}`: the video in both formats and its poster, one set per theme. Other languages add the code, as in `voice-fr-dark.webm`, and the build falls back to the English file when there is none;
- `<name>.json` with `seconds`, `speed` and `model`, which the caption reads.

The capture scripts live in the app repo:
- `../../app/scripts/clips.cjs` records the clips (1280×800, model waits sped up and labeled in the caption);
- `../../app/scripts/screenshots.cjs` takes the documentation shots, which land in `../docs`.

Both run on a throwaway profile and write into `websites/`. They attach to the app through `app/scripts/tauri-app.cjs`, which launches a built `draggy-win.exe` (`npm run tauri:build` or `--exe`). Set `DRAGGY_SHOTS_OUT` or `DRAGGY_CLIPS_OUT` when this checkout is not next to the app.

- **Capture:** both themes, every language where UI text shows, with a seeded demo project and no personal paths.
- **After any app UI change**, re-capture the affected shots and update `shots.json`.
- **Clip limits:** at most 1.5 MB as WebM with an MP4 fallback, a poster under 60 KB, `muted playsinline loop preload="none"`, and no autoplay under reduced motion.

## Design rules

The direction is "the app is the picture":
- a green palette in dark and a sky-blue one in light, in Geologica; the theme follows the system alone, with no switch;
- no structural 1px lines: surfaces are separated by fills and space (tables and code blocks in the docs are the one exception);
- one accent per theme (`--accent` is `#8db89b` in dark and `#1e78b4` in light; text uses `--accent-text` and button labels `--accent-ink` for AA contrast);
- the build number shows once, in the footer;
- motion is transform only (opacity fails axe on text), and off under reduced motion; the home page's sticky scroll stage, word reveal and logo marquee fall back to plain content without script;
- the real app shown large, with motion only from the clips.

Never add:
- gradients (only a `mask-image` edge fade is allowed), blur, glow or decorative blobs;
- pill buttons (button radius stays at 14px or less);
- ASCII art or mascot poses (the head logo and the home hero's dragon are the only marks);
- generated illustrations or stock imagery.

**Budgets:**
- home under 600 KB on first load, not counting clips;
- JS under 25 KB gzipped;
- Lighthouse 95+;
- WCAG 2.2 AA;
- CLS under 0.05;
- no horizontal scroll from 320px up.

For UI work, use the `impeccable` skill.

## Writing rules

- Run every user-facing English string through the `/unslop` skill (or `/anthropic-skills:humanizer` when it isn't installed).
- Voice: plain, concrete, calm. Sentence case. No em dashes. No exclamation marks.
- Never say "offline". No benchmarks, no model-quality claims, and no numbers that weren't measured on the current release.
- Check every factual claim against the app at its current version. If you can't confirm it, cut it.
- Four languages with full key parity. Write English first, then translate fr, es and ru from it. Match terms to the app's `../../app/src/translations.ts`.
- The star count stays hidden below `starsMin` (25).

## Privacy and security

- The site sets one cookie, `draggy-lang`, and only to remember a language choice. It has no forms and no login. The only analytics is Vercel Web Analytics (cookieless), and it is disclosed in the privacy policy. Nothing is kept in local storage; the theme is the system's. The head script only sets the OS for the download button; its sha256 is pinned in the CSP in `vercel.json`, so update the hash when you change that script.
- Make no third-party requests apart from Vercel's own.
- Do not use `innerHTML` with any data. Build DOM nodes instead.
- Keep dependencies pinned.

## Git

- Commit messages are a subject line only, with no body and no attribution lines.
- Do not push or deploy unless asked. Vercel deploys from the default branch.

## Subagents

- Spawn subagents only on the latest Haiku model (`model: "haiku"`). Never spawn Opus, Sonnet or other larger models as subagents.
- Spawn as few as the task needs.
