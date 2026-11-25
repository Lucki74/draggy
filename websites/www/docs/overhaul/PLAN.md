# draggy.org overhaul plan

Built on 2026-10-12 from seven audits: code, UX/a11y/perf and copy audits of this repo, plus teardowns of Hermes Agent, Ollama, Claude Code, Cline, Kilo Code, OpenClaw and Poolside. The full reports are in `docs/overhaul/research/`.

## How to work this plan

- Work top to bottom. Phase 1 ships before any design work starts.
- When an item is done, change `- [ ]` to `- [x]` in the same commit as the change. If an item turns out wrong or unneeded, mark it `- [x]` and add `(dropped: reason)`.
- One phase or sub-phase per PR. Before each commit, run `npm run build`, `npm test`, `npm run i18n` and `npm run tokens:check`.
- **Any text a visitor can read** (pages, locales, wiki, policy, errors, meta, OG card, llms.txt) goes through the `/unslop` skill before commit. Write English first, then translate fr, es and zh from it. If `/unslop` isn't available in the session, use `/anthropic-skills:humanizer` instead (owner's call, 2026-10-12).
- For UI work, use the `impeccable` skill. Follow every rule in `AGENTS.md` (no gradients, blur, glow, pills, mascots or generated art; budgets; CSP).
- Subagents run only on the latest Haiku model.
- Items marked **(verify)** need the app repo. Attach `Lucki74/draggy` as `../draggy` first, and cut any claim you can't confirm.

## Owner decisions (2026-10-12)

- Cookie: keep the `draggy-lang` cookie and the automatic language redirect. Say so honestly everywhere: one cookie, only to remember your language.
- Hero headline: "A free AI assistant that runs on your own computer."
- "Who makes Draggy": one independent developer, no company, no funding, Apache 2.0.
- Copy skill: `/anthropic-skills:humanizer` stands in for `/unslop` when it isn't installed.
- Clip captions stay hidden on purpose.

## Where Draggy already wins (keep it)

- First load is about 120 to 550 KB. Competitors load 1.7 MB (Poolside), 2.4 MB (Cline), 2.5 MB (OpenClaw), 3.9 MB (Claude Code) and 7.2 MB (Hermes).
- JS is 4.3 KB gzipped against 0.2 to 1.5 MB. No third-party requests, CLS 0, no overflow from 320px.
- Lighthouse scores 98 to 100. Dark mode, skip link and focus rings all work.
- No popups, cookie banners, newsletter forms or trackers.
- The download page has checksums, the unsigned-build explanation and file sizes. No competitor has that.

## Do not copy

These came up in the competitor research:
- the blue full-bleed field, engravings, parallax, grain, glow frame, blurred footer and watermark opacity (Hermes);
- the AI-generated cartoon art and ASCII backdrop (OpenClaw);
- popups, newsletter forms, cookie sheets and trackers;
- hype headlines ("The AI that really does things", "fastest path to AGI"), unverified stats, testimonial carousels and logo walls;
- pill badges, rotating hero copy, dark-only themes and 60-link footers;
- ASCII ornaments like ": macOS :" and "//MOST POPULAR".

---

## Phase 0: Setup

- [x] Attach the app repo (`Lucki74/draggy`) at `../draggy`. Fact checks, captures and `translations.ts` need it.
- [x] Confirm the `/unslop` and `impeccable` skills load in the session. (Neither is installed in cloud sessions. Use `/anthropic-skills:humanizer` for copy. For UI, follow the AGENTS.md design rules directly.)

## Phase 1: Bugs and rule violations

### Broken output
- [x] (dropped: owner says hiding captions is intended) Clip captions never render. `tools/build.mjs:1068` drops the caption key, so all 6 clips ship with no `<figcaption>`, and the required "waiting time sped up" label is missing. Wire it through `clip()`, fill `{version}`, `{model}` and `{speed}` from `assets/clips/<name>.json` and `release.json`, and add a test that every clip has a caption with its speed.
- [x] 12 keys in `tools/locales/es.json` show mojibake ("c├│digo", "est├í") on six es pages. Fix them, and add a test that rejects `├`, `Ã` and U+FFFD in any locale.
- [x] `/download` and `/download/` return 404 (`cleanUrls: false`, no redirect). Add permanent redirects in `vercel.json` for every page's extensionless and trailing-slash form, in every language. Also redirect `/en` and `/en/*` to `/`. Add tests. (Wiki, error and privacy pages are directory indexes and already answer without the extension.)
- [x] The home macOS button sends Intel Macs the arm64 DMG. Offer Apple silicon and Intel, as the download page does.
- [x] `detectOs()` in `assets/js/site.js:31` labels iPhones as macOS. Check mobile first.
- [x] Wiki navigation is hidden at every width up to 1366px, because `assets/css/wiki.css:124-133` hides `.wiki-nav`, which contains the disclosure. Keep the nav visible and let the `<details>` collapse, closed by default on small screens. Remove the empty 320px column at 1024px.
- [x] `padding-start` is not a CSS property (`wiki.css:213`, `:228`), so check marks overlap the first letter. Use `padding-inline-start`.
- [x] Wiki tables are clipped on phones (min-width 400px in a 332px box). Make the wrapper scrollable and focusable (`tabindex="0"`, `role="region"`, `aria-label`).
- [x] Clip player: the last entry in each IntersectionObserver batch wins, so a fully visible clip can stay paused. Play the most visible clip instead.
- [x] Paused light clips freeze on a pure white first frame. Show the poster when paused, or re-capture with a non-blank first frame.
- [x] The dark voice and browser clips render as empty black tiles. Check their posters and fix. (Posters were fine; the clip player flapping between clips caused it.)
- [x] Download page at 390px: the "Every file" table loses its column labels. Copy buttons are 31×21 and 15 targets are under 24px. Make every target at least 24×24.
- [x] Escape doesn't close the language menu. Make the switcher's accessible name contain its visible label.
- [x] The footer pause button announces two states (its label contradicts `aria-pressed`, `site.js:377`, `build.mjs:563`). Keep one label and express state with `aria-pressed` only.
- [x] The `--shadow` token is a 30px blur (`assets/css/site.css:50`, `:66`), and blur is banned. Replace it with a 1px hairline border.
- [x] The home headings jump from h1 to h3 in the values section. Fix the order.
- [x] The `/error` index omits 9 of 37 English error pages (`build.mjs:817-866`), and `site.test.mjs:228` repeats the same list. Derive both from `ERROR_SLUGS`.

### Release data
- [x] Download links point to `releases/latest`, while checksums and sizes are a daily snapshot. For up to 24h after a release, the SHA-512 doesn't match. Link to the tagged release (`releases/download/<tag>/<file>`) and rebuild when a release is published.
- [x] When GitHub is unreachable, the build silently uses `release.json`. Print a loud warning in CI.
- [x] `tools/fetch-release.mjs:56` hash parsing depends on manifest key order. Parse the YAML properly.
- [x] `release.version` is not validated (`fetch-release.mjs:82`). Require `^\d+\.\d+\.\d+$`.

### Dependencies and tooling
- [x] Pin `@phosphor-icons/core` and `ffmpeg-static` exactly in `package.json`. Remove `ffmpeg-static` if nothing in this repo uses it (no tool imports it now). Pin GitHub Actions by SHA.
- [x] `npm test` rebuilds and wipes `public/`. Build test output into a temp dir.
- [x] Two tests pass with zero assertions when `../draggy` is missing (`site.test.mjs:265`, `:282`). Make them skip visibly.
- [x] The `check-tokens.mjs:24` regex is a template literal, so `\s` turns into `s`. Fix it.
- [x] `check-i18n.mjs` reports 11 used keys as unused (`errors.`, `privacyPolicy.`, prefix matches). Fix that, then delete the 18 keys that really are dead, in all four languages.
- [x] Delete the 44 unused screenshot files (1.46 MB) in `assets/img`, and the dead client strings (`build.mjs:393-412`).
- [x] Check the build output for a whole page before writing anything, so a throw mid-build doesn't leave `public/` half-written (`build.mjs:1183`).
- [x] The wiki parser merges duplicate slugs silently (`build.mjs:612`). Throw, as `readErrors` does.

### Middleware
- [x] Keep the query string on the language redirect (`middleware.js:132`).
- [x] Parse Accept-Language q-values, sort them, and drop `q=0` (`middleware.js:59-70`).
- [x] Let the browser's language beat the IP country. Today an `en-US` browser in France gets `/fr` (`middleware.js:118-124`).
- [x] Match explicit bot tokens with word boundaries. "CUBOT" phones currently count as crawlers (`middleware.js:79`).
- [x] Add `Vary` to pass-through responses (`middleware.js:110`).

### Hardening and SEO
- [x] Escape `<` in JSON-LD (`build.mjs:472`, `:503`). Escape locale strings that go into attributes, title and meta (`build.mjs:330`, `338-348`, `273`, `563`, `990`).
- [x] When the share sheet is cancelled, don't copy the link (`site.js:144-161`). Move the share text into the locales (`site.js:148`).
- [x] Run each `site.js` setup in its own try block, so one throw in an older browser doesn't skip the rest (`site.js:397-406`).
- [x] Use `og:locale` as `en_US`, `fr_FR`, `es_ES`, `zh_CN`, and set the WebSite `inLanguage` to `zh-Hans`.
- [x] Trim the fr and es home descriptions to 160 characters or fewer.
- [x] Confirm no subdomain is HTTP-only before keeping `includeSubDomains` in HSTS. (Only `www` exists, on Vercel over HTTPS.)

## Phase 2: Truth pass (copy accuracy and privacy)

Every item here goes through `/unslop` and is fixed in all four languages.

- [x] The privacy policy, in all four languages, claims a theme key in local storage that doesn't exist and omits `draggy-clips-paused`. Match it to `site.js`.
- [x] `AGENTS.md` says "no cookies", but `draggy-lang` is set (`site.js:121`, `middleware.js:54`). Decide whether to keep the cookie or drop it along with the auto-redirect, then update `AGENTS.md`, the policy and every "no cookies" claim to match.
- [x] "No telemetry" appears in `index.description`, `og.meta`, `tools/og-card.html:109`, JSON-LD, `llms.txt` and the wiki. **(verify)** it against the app. If it stays, it must be true for the app; the site itself runs Vercel Analytics. Regenerate `og.png`.
- [x] Fix the overclaims, **(verify)** each:
  - `home.f3Text` (the default Accept edits mode doesn't ask before edits);
  - `home.trust` and `home.v1Title` (only true without a cloud provider);
  - `faq.a2` (cloud voice sends text out);
  - wiki line 3 and the policy lines "Nothing about you is collected" and "runs with no network connection at all" (update checks are on by default);
  - "Draggy never sees your password";
  - "the only extension that sends anything";
  - "Every Mac with Apple silicon".
- [x] All four policies and the wiki cite `providers.json`, which isn't in this repo. **(verify)** Link the file in the app repo, or cut the reference.
- [x] Resolve the wiki contradictions:
  - Ctrl+K is documented as both the command palette and "change model";
  - two different macOS quarantine commands;
  - the 60% threshold is stated two ways;
  - the Mac table omits 2020 Intel Macs and the 13-inch M2.
- [x] "colibri" appears 11 times in the error pages and is never defined. Define it or use the app's user-facing name.
- [x] **(verify)** Measure these on the current release, or cut them:
  - unmeasured numbers: `hw.disk` "10 GB", `hw.gpu.verdict` "Qwen 3.5 9B", the wiki model-by-VRAM tables;
  - timings: twenty seconds, six hours, ten minutes, 1500 ms, 0.9x to 1.25x;
  - "several gigabytes".
- [x] **(verify)** The `site.config.json` counts (107 MCP, 66 skills, 29 on) are typed by hand. Generate them from the app repo at build time.
- [x] **(verify)** Check the "Windows 10 1809 or newer" line against what the app supports. Consumer Windows 10 ESU ends 13 October 2026.
- [x] Change `nav.stars` to "Draggy on GitHub". The count is hidden below `starsMin`.
- [x] Move the labels hard-coded in English in `tools/pages/download.html` into locale keys.
- [x] zh mixes 提供方/服务商 and 语音模式/语音对话. Match the app's `translations.ts`, and run the same check for fr and es.
- [x] Use "Gemini" consistently (`faq.q4`, `faq.a4`, `index.description`).
- [x] Merge the duplicate keys `hero.heading` and `home.heading`. Unify "isn't" and "is not" across `404.message` and `notFound.description`.
- [x] Change "Apple Silicon" to "Apple silicon" (wiki `en.html:134`).
- [x] On the download page, say "Nothing is code signed" once instead of four times. Fix the logic in `download.official`: you *can* tell a tampered file, by its SHA-512.

## Phase 3: Home page overhaul

Use the `impeccable` skill. The goal is "the app is the picture", at a size where its text is readable.

### Hero
- [x] Write an H1 that says what Draggy is: an app, an AI assistant, on your computer. The audit's options to start from: "A free AI assistant that runs on your own computer." / "An AI assistant that works in your folders, on your own computer." / "Chat, web research and coding, with the model on your computer." Run them through `/unslop` and let the owner pick.
- [x] Add a subhead. `hero.lede` exists and is only used in `llms.txt`. Mention that Draggy can use servers you already run (Ollama, LM Studio) **(verify)**.
- [x] The platform line ("Also for macOS and Linux") is static and wrong for Mac and Linux visitors. Name all three systems, or follow detection.
- [x] Add a small Windows / macOS / Linux switch beside the main button that swaps the label, file and size. Detection stays the default; macOS offers Apple silicon and Intel.
- [x] Under the button, show the version, release date and size instead of "Build 1". Add the date to `release.json` in `fetch-release.mjs`.
- [x] Show the hero clip at full wrap width (about 1,040 to 1,120px), directly under the buttons. It is 658px today; Hermes uses 1,080 and Poolside 1,040.
- [ ] Re-capture the clips (`../draggy/scripts/clips.cjs`) cropped to the working pane, so UI text shows near 1:1. Keep each clip at 1.5 MB or less, with posters under 60 KB.
- [x] Add a link to "Will it run on mine?" under the buttons.
- [x] Fix the zh headline, which breaks inside 编程 (`word-break: keep-all` or `<wbr>`).
- [x] Clarify the phone main button ("Copy link"), so phone visitors know the app is for desktop.

### Type, space and color
- [x] Set the H1 at display size: `clamp(48px, 7vw, 104px)`, weight 400 to 500, line-height 1.0, -0.02em. It is 56px/600 today.
- [x] Raise H2 from 40px to about 64px, put 120 to 180px above each section, and remove most hairlines.
- [x] Put the app's accent on the primary button and active states only. No accent shows on the home page today.
- [x] (kept 8px) Decide on corner radius: 8px now, or 4 to 6px for a sharper look (Hermes uses 3px). Stay at 12px or less either way.
- [x] Fix the header at 320 to 390px, which is cramped. Make ghost-button and icon borders visible enough.

### Sections
- [x] Replace the five stacked feature clips with one large tabbed clip switcher. Only the active clip loads, which cuts about 1,000px of page height. Requirements:
  - an accessible tablist with arrow keys;
  - without JS, the clips fall back to stacking;
  - reduced motion shows posters;
  - the footer pause button still controls everything.
- [x] Replace the fragment titles ("The research.", "The code." and the rest) with plain, descriptive ones.
- [x] Deduplicate the values and "Free to use" sections: "No account" shows 3 times and "Apache 2.0" 4 times. Merge them into one block.
- [x] Add a trust strip of facts a visitor can check: Apache 2.0, no account, Windows/macOS/Linux, no third-party trackers **(verify, and match the cookie decision)**. Show the star count only at `starsMin` or more. Invent no social proof.
- [x] Add a short "Who makes Draggy" block: maintainer, funding, license, and what the app sends. The owner supplies the facts.
- [x] Expand the FAQ, **(verify)** each answer:
  - "Can I use models I already have?"
  - "Does it ask before it changes things?"
  - "Why does my computer warn me when I open it?"
  - "Does it update itself?"
  - "Which languages?"
- [x] (skipped: kept the page calm) Optional: end the page with a large plain "Draggy" wordmark in ink, with no effects.
- [x] Lazy-load the posters below the fold, and start each clip only when it is near the viewport.

## Phase 4: Download page

- [x] Put the detected system's card first, labeled "Your system". Cards currently always run Windows, macOS, Linux.
- [x] Add a requirements row to the header: OS versions, memory, disk. **(verify)** and measure every number.
- [x] Add a three-step strip at the top: install, expect the unsigned-build warning (link to how to get past it), pick a model.
- [x] Show copyable Linux commands (`chmod +x` for the AppImage, `sudo apt install ./Draggy-amd64.deb`) and the checksum commands. Use monospace blocks that wrap on phones, with copy buttons that confirm.
- [x] Show the version and date for each file. Add a changelog strip with the three latest releases as dated plain bullets, built from GitHub release data, with a link to all release notes.
- [x] Rewrite the vague download button labels, and fill the empty space at wide widths.

## Phase 5: Wiki

- [x] Add a version line at the top of each page, saying which version it describes and where to check yours in the app **(verify the menu path)**.
- [x] Run the wiki screenshots through the image pipeline (`shots.json`, AVIF/WebP, sizes). They ship as raw PNGs now.
- [x] At 1440px, the wiki index shows the whole nav above its title. Fix the layout.
- [x] Remove the underline from the index card descriptions. Change the pager label "Previous Wiki" to a plain label.
- [x] Add a glossary page (engine, provider, GGUF, quantization, context window, compaction, MCP, skill, embedding model, Talk, Auto) and link each term's first use.
- [x] Link Uninstall from Installation, not only from Privacy.
- [x] Add one Security page that collects permissions, refused paths, "run_code is not a sandbox", remote servers and log safety.
- [ ] Wiki search: skip until the wiki outgrows its sidebar. Leave this unchecked and revisit then.

## Phase 6: New pages and site structure

- [x] (dropped: one release so far; the download page's recent releases strip and the GitHub releases link cover it. Revisit after a few releases.) Changelog page by version and build, linked from the download page and the footer.
- [x] "How Draggy compares" page: a feature table against Ollama, LM Studio, Claude Code and Cline. No quality claims, and every row **(verify)** against current versions.
- [x] Open source page: what is Apache 2.0, what the models' own licenses are, what leaves the machine.
- [x] Models page: supported model families and their licenses **(verify)**.
- [x] (Changelog dropped with the page; the footer links Releases) Footer: add Changelog, Contribute (CONTRIBUTING.md), Security (SECURITY.md and `security.txt`) and the wiki.
- [x] Add a System / Light / Dark theme control: segmented, radius 12px or less, stored per viewer, inside the CSP. Disclose the storage key in the privacy policy.
- [x] Add a short accessibility statement with a contact (WCAG 2.2 AA).
- [x] Translate every new page into fr, es and zh, and run `npm run i18n`.

## Phase 7: Guardrails

- [x] Add pinned `axe-core` to `npm test`: home, download and two wiki pages, in en and zh.
- [x] Add tests (the caption check dropped: captions are hidden on purpose):
  - every clip has a caption;
  - no mojibake in any locale;
  - redirects for every page form;
  - heading order with no skips;
  - every tap target is at least 24px.
- [x] Add a Playwright overflow check at 320, 390 and 1440px for every page type. Optional if it slows CI too much.
- [x] Update `AGENTS.md`: the cookie line, new pages and CSS files, and the `docs/overhaul/` folder.

## Phase 8: Before merge to main

- [x] Lighthouse 95+ in all four categories, mobile and desktop, for home, download and one wiki page. (Best practices reads 96 locally only because `/_vercel/insights/script.js` 404s off Vercel.)
- [x] Home under 600 KB first load (excluding clips), JS under 25 KB gzipped, CLS under 0.05, no horizontal scroll from 320px. (Measured: 143 KB, 7.7 KB gzipped, CLS 0.)
- [ ] Re-capture every shot and clip affected by UI changes: both themes, every language where UI text shows. Update `shots.json`. (Build 5: not done, needs a live app run. See `build-5-notes.md`.)
- [x] Full key parity across en, fr, es and zh. All public text has been through `/unslop`. (Used `/anthropic-skills:humanizer`, since `/unslop` is not installed.)
- [x] The owner reviews the hero copy and the "Who makes Draggy" block before merging. (Owner approved the merge on 2026-10-12.)
