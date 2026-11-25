# draggy.org code audit (read-only)

Repo: /home/user/draggy-website. Audited commit d5f339b. HEAD later moved to 7de1dd3, which only adds a "Subagents" section to AGENTS.md. Every audited source file is unchanged from the copy I built and tested.

Method: read every tool, the middleware, vercel.json and site.js. Built a scratch copy outside the repo and ran `npm test` there (40/40 pass); `public/` is byte-identical to that build. Crawled all 232 HTML files in `public/` with a stdlib script. Probed the middleware with crafted headers. Measured clip files, image dimensions, gzip sizes and locale text. Scripts and raw output are in `scratchpad/scripts/code-audit/`. Nothing in the repo was edited, committed or pushed.

Not run here: `npm run build` and `npm test` in the repo (the test suite rebuilds and wipes `public/`, see L7). Lighthouse, CLS, WCAG contrast and 320px overflow were not measured (no browser). The app repo `../draggy` is absent, so app-side claims are unverified.

## Summary

| Severity | Count | Items |
|---|---|---|
| High | 1 | H1 clip captions and speed labels never render |
| Medium | 4 | M1 checksum/link mismatch window, M2 privacy policy storage, M3 AGENTS "no cookies", M4 /error index incomplete, M5 unpinned deps and unused install script |
| Low | 31 | L1 to L31 |

---

## HIGH

### H1. Clip captions, speed labels and model names never reach the page
- **Where:** `tools/build.mjs:1068` (the regex captures the caption key as the third group, then the callback is `(_, name, alt) => clip(t, to, name, alt)`, so it is dropped); `tools/build.mjs:972-998` (`clip()` emits no `<figcaption>`); `tools/locales/en.json:180-192` (caption strings); `tools/pages/index.html:20,50,57,64,71,78` (the six placeholders).
- **What is wrong:** every clip is declared with a caption key, for example `{{clip:research|clip.research.alt|clip.research.caption}}`. The caption strings contain `{version}`, `{model}` and `{speed}`, and nothing fills those in. In the built `public/index.html` there are 0 `figcaption`, 0 "sped up" and 0 "Recorded on" occurrences. `assets/clips/*.json` (`seconds`, `speed`, `model`) is never read by the build.
- **Failure scenario:** a visitor watches the research clip, which is sped up 24x per `assets/clips/research.json`, or the browser clip at 20x, with no label. AGENTS.md requires the speed-up to be labeled in the caption.
- **Why the checks miss it:** `npm run i18n` counts `clip.*.caption` as used because the page source names the key, and no test asserts a figcaption exists.
- **Also:** the JSON `seconds` does not match the WebM durations for hero (12 vs 14.25 s), code (24.7 vs 17.4 s) and browser (11 vs 12.8 s). The field's meaning is undocumented, so settle that before rendering it.
- **Fix:** render `<figcaption>` in `clip()` with the translated caption, filling `{version}` from release.json, `{model}` and `{speed}` from the clip JSON. Make the build fail on any unfilled single-brace placeholder. Add a test that each `figure.clip` has a caption containing the speed.

---

## MEDIUM

### M1. Download checksums can disagree with the file behind the link for up to a day after each release
- **Where:** `tools/fetch-release.mjs:97` (the download URL floats to `releases/latest/download/…`); `tools/fetch-release.mjs:92-99` (the sha512 and size are a snapshot); `.github/workflows/release-data.yml` (cron `0 6 * * *`, no `release` trigger); `tools/fetch-release.mjs:110-119` (silent fallback to release.json).
- **Failure scenario:** build N is published. `releases/latest/download/draggy_setup.exe` now serves N, but the page still shows build N-1's sha512 and size until the next 06:00 UTC run. A reader who follows the page's own "compute the SHA-512 and compare" step (`download.checkLede`) gets a mismatch and may conclude the file was tampered with.
- **Fallback behaviour:** when GitHub is unreachable or rate limited, `loadRelease()` logs a warning and uses release.json. I confirmed this here: the live fetch returned 401, the build printed "using release.json" and exited 0.
- **Fix:** link tag-pinned URLs (`releases/download/<tag>/<file>`) so the URL and the hash move together. Trigger the refresh on `release: published`. Fail the deploy build, or print a loud banner, when the fallback is used.

### M2. Privacy policy misdescribes what the browser stores
- **Where:** `tools/policy/en.html:57`; `assets/js/site.js:210-211` (writes localStorage key `draggy-clips-paused`); `assets/js/site.js:364` (the only theme code is a listener that stops clips).
- **What is wrong:** the policy says "your theme, in local storage" and that this happens "only if you use the control that sets them". No theme control or theme storage exists. The site follows `prefers-color-scheme` only (`assets/css/site.css:58,234`). The real key, `draggy-clips-paused` from the footer pause button, is not disclosed.
- **Fix:** rewrite the storage paragraph. Disclose the `draggy-lang` cookie and the `draggy-clips-paused` key, and drop the theme claim. I checked only the English policy; the fr, es and zh policies need the same check.

### M3. AGENTS.md says the site has no cookies, but the code sets one
- **Where:** AGENTS.md, "Privacy and security": "The site has no cookies, no forms and no login."
- **Code:** `assets/js/site.js:121` sets `draggy-lang` for a year. `middleware.js` reads it and clears dropped values (`CLEAR_COOKIE`). The policy discloses the cookie, so the rule document is the stale part.
- **Fix:** either update AGENTS.md to name the one functional cookie, or remove the cookie. As written, the documentation and the code contradict each other.

### M4. The /error index omits 9 of the 37 English error pages, and the test repeats the same list
- **Where:** `tools/build.mjs:61` (comment: /error lists "every page an error in the app links to"); `tools/build.mjs:817-866` (`ERROR_GROUPS`, 28 slugs); `tools/build.mjs:877` (`errorList` silently skips slugs not in a group); `tools/site.test.mjs:228-239` (the same 28, hand-typed). The build checks groups against English but never the reverse.
- **Missing from /error:** `colibri-blocked-by-windows`, `colibri-disk-read`, `colibri-model-format`, `colibri-out-of-memory`, `colibri-unsupported-model`, `image-engine-unsupported-cpu`, `image-engine-would-not-start`, `image-model-damaged`, `image-out-of-memory`. All nine are built in four languages, marked noindex, and reachable only by URL.
- **Fix:** put the nine slugs into `ERROR_GROUPS`. Make the build fail when an English slug is in no group. Derive the test's list from `tools/errors/en.html` rather than typing it.

### M5. Dependency pinning rule is broken, and an unused package runs an install script
- **Where:** `package.json` devDependencies: `"@phosphor-icons/core": "^2.1.1"` and `"ffmpeg-static": "^5.3.0"`. AGENTS.md says to keep dependencies pinned. `package-lock.json` entry `node_modules/ffmpeg-static` has `hasInstallScript: true`.
- **What is wrong:** nothing in this repo imports ffmpeg-static (grep confirms). Its install script still runs on every `npm ci`, including Vercel builds and the release-data workflow.
- **Also:** `.github/workflows/release-data.yml` references `actions/checkout@v4` and `actions/setup-node@v4` by tag, in a job with `contents: write`.
- **Fix:** remove ffmpeg-static from this repo, or move it to the app repo if clip encoding lives there. Exact-pin the rest. Pin the actions to commit SHAs.

---

## LOW

### Middleware (`middleware.js`)

- **L1. Query string dropped on the language redirect.** Line 132 builds `Location` from `new URL(\`/${language}\`, request.url)`. Probe: `/?utm_source=hn&ref=x` from a French IP becomes `/fr`. Campaign attribution is lost on first visit. Fix: carry `request.url` search params over.
- **L2. Accept-Language ignores q-values, and q=0 counts as accepted.** Lines 59-70 (`preferred`). Probe: `fr;q=0.1,en;q=0.9` goes to `/fr`; `fr;q=0,en;q=0.5` goes to `/fr`. Fix: parse q, sort descending, drop q=0.
- **L3. Country outranks the browser's explicit language (design question).** Chain at lines 118-124. An English-only browser (`en-US`) from France gets `/fr`; `en-GB` from Singapore gets `/zh`; `en-US` from Spain gets `/es`. The header comment documents the order, but Singapore is an English-majority country, so mapping it to Chinese is worth a product decision.
- **L4. Crawler heuristic is too broad.** Lines 79-81 use `/bot|crawl|spider|slurp|google|lighthouse/i`. Probe: a CUBOT phone user agent matches, so that visitor is treated as a crawler and kept on English. Fix: match explicit bot tokens with word boundaries.
- **L5. Pass-through responses carry no `Vary`.** Line 110 (`next()`) omits `Vary`, while the redirect at line 136 sets it. The decision depends on Cookie, IP country and Accept-Language. The caching impact on Vercel was not verified here.
- **L6. zh-Hant is treated as Simplified.** Line 63 takes the first two characters, so `zh-Hant-TW` goes to `/zh`. Note only, since no Traditional page exists.

### Tests

- **L7. `npm test` rebuilds and wipes `public/` in place.** `tools/site.test.mjs:20-24` and `:195-217` call `build.mjs`, which runs `rmSync(out)` (`build.mjs:1183`). Anyone previewing `public/` while tests run gets 404s, and the three-build sequence at lines 193-219 rewrites the output three times. I ran the suite in a copy for this reason.
- **L8. Two tests pass with zero assertions here.** `site.test.mjs:265-267` (no `engineErrors.ts`) and `:282-284` (no app README) return early. Of 40 passing tests, 2 are vacuous in this environment.
- **L9. Coverage gaps.** `site.test.mjs:65` skips any `<link>` whose rel is outside its allow-list, so `preconnect` or `dns-prefetch` to a third party passes unchecked. `<video src>`, `<object>`, `<embed>` and CSS `url()` to external hosts are not checked. Hreflang reciprocity, canonical-equals-URL and sitemap-equals-indexable-pages are untested; the crawl found all three clean, so they should become tests. No JS or CSS budget test exists. The home budget test (`:374-376`) excludes fonts and images, though my estimate of about 170-220 KB is well under 600 KB. The middleware tests cover no query strings, q-values or `Vary`. The test title at `:148` says "in the sitemap" but never reads it.

### Dead or stale code and assets

- **L10. Unused generated images.** 44 AVIF/WebP screenshot copies (1.46 MB) ship in `public/assets/img`, and no built page references any of them. `picture()` (`build.mjs:1005-1030`) and the `{{shot:}}` regex (`build.mjs:1067`) are reachable only through placeholders that no template uses. `tools/images.mjs:22` says these are the pictures the home page draws, but the home page has none. `assets/img/icons.svg` (33 KB) is served and referenced by no page, since pages inline `_icons.html`.
- **L11. Strings sent to the client and never read.** `build.mjs:393-412` sends `yourSystem`, `images` and `table.*`. `site.js:23` reads only `copy` and `copied`.
- **L12. Stale code and comments.** `build.mjs:316` `split(": ")` cuts wiki titles, but no wiki title in any locale contains a colon; the model tables it described were removed in commit 6f0e755. `build.mjs:322` `const preload = ""` is dead. `build.mjs:1002-1003` says site.js rewrites picture media on a manual theme choice; no such code exists. `site.js:47-49` loops over `[data-os-name]`, which no built page uses.

### Client script (`assets/js/site.js`)

- **L13. iPhone is detected as macOS.** Line 31 tests `"mac"` before any mobile check, and the iPhone user agent contains "Mac OS X". I ran `detectOs()` extracted from the file: the iPhone UA returns `macos`. Effect: the macOS first-run step opens on iOS. The head script already computes `data-os="mobile"` (`build.mjs:359-374`) and site.js ignores it.
- **L14. Dismissing the share sheet copies the link anyway.** Lines 144-155: the `catch` around `navigator.share` (which rejects when the user cancels) falls through to `clipboard.writeText` and shows "Copied" (lines 157-161).
- **L15. Share text is hard-coded English.** `site.js:148` is not in any locale file, so fr, es and zh pages share English text.
- **L16. One throw skips the later setups, and some old browsers fail to parse the file.** Lines 397-406 run `setUpClips`, `setUpMotion` and `showCurrentWikiPage` in one handler. Line 364 calls `MediaQueryList.addEventListener`, which Safari before 14 lacks, so the footer pause button is never wired there. Line 270 uses `??=`, which needs Safari 14; older browsers fail to parse the whole file, which degrades gracefully. No browser floor is stated anywhere.
- **L17. Motion toggle label contradicts `aria-pressed`.** `site.js:377-378` and `build.mjs:563`: when pressed is `true`, the label reads "Play clips". Fix: keep one label and express state with `aria-pressed` alone.

### Escaping (defence in depth; no current exploit)

- **L18. JSON-LD is not escaped.** `build.mjs:472` and `:503` use `JSON.stringify`, which leaves `<` alone. I verified all 68 blocks parse and none contains `</`. A translator string or release value containing `</script>` would break out. Fix: escape `<` as `<`, as `strings()` already does.
- **L19. `release.version` is unvalidated.** `tools/fetch-release.mjs:82` captures `(\S+)`, which lands in HTML text and JSON-LD (`build.mjs:456, 494`, `{{r:version}}`). Exploiting it requires write access to the release assets. Fix: require `^\d+\.\d+\.\d+$`.
- **L20. Locale strings go raw into attributes and title/meta.** `build.mjs:330, 338-348, 273, 563, 990`. No current string contains `"`, `&` or `<` (checked in all four locales), but nothing enforces that, so one translator's quote silently breaks markup. Fix: one escaping helper and a build check.

### Build and data

- **L21. Wiki parser merges repeated slugs and drops unmatched markers.** `build.mjs:612-625` has no duplicate check (unlike `readErrors` at `:138-140`). A marker containing digits or capitals becomes body text of the preceding article.
- **L22. Fragile hash parsing.** `fetch-release.mjs:56` requires `- url:` to be directly followed by `sha512:`. If manifest key order changes, line 92 falls back to downloading each 130-170 MB file.
- **L23. Token checker regex bug.** `check-tokens.mjs:24` is a template literal, so `\s` becomes `s`. The compiled pattern is `--bgs*:s*([^;]+);`, which works only for `--bg:` and reports a false error for `--bg : #fff;`. The dark check at line 23 reads only the first media block.
- **L24. i18n checker false positives.** `check-i18n.mjs:36` does not match `errors.`, `privacyPolicy.` or `errors.group.`, which `build.mjs:313, 318` build from page ids. Substring matching at line 46 can mark keys as used by prefix.
- **L25. Build is not atomic.** `build.mjs:1183` wipes `public/` before any page is rendered, and the writes at `build.mjs:1188-1203` follow one by one. A render that throws midway leaves a half-written `public/`. Harmless on Vercel, which deploys only successful builds, but it bites local previews.

### SEO and HTML

- **L26. `/en` has no redirect.** Neither `vercel.json` nor the middleware matcher (`/`, `/index.html`) handles it, and AGENTS.md says `/en/` does not exist.
- **L27. Locale codes in meta.** `og:locale` is `en`, `fr`, `es`, `zh` (`build.mjs:336`) rather than `language_TERRITORY`. WebSite `inLanguage` is `zh` (`build.mjs:445`) while `<html lang>` is `zh-Hans`.
- **L28. Descriptions over 160 characters.** `es/index.html` is 173 and `fr/index.html` is 180 characters, so search results truncate them.
- **L29. Heading levels skip.** The home pages (en, fr, es, zh) go from `h1` straight to `h3`. Four pages in total have a skip, measured by regex.
- **L30. HSTS includes subdomains.** `vercel.json` sets `max-age=63072000; includeSubDomains`. Before this ships, confirm no subdomain is HTTP-only. I could not check DNS from here.
- **L31. Unverified app and marketing claims.** The OG card says "no telemetry" (`tools/locales/en.json` `og.meta`, baked into `assets/img/og.png`). `site.config.json` counts (107 MCP servers, 66 skills, 29 on) are typed by hand. Neither can be checked without the app repo, which AGENTS.md requires.

---

## Verified clean

- **Links and SEO** (crawl of 232 files): zero broken internal links, fragments or asset references. All 73 `#i-*` icon references exist in the sprite. Zero duplicate ids. All 80 indexable pages have a canonical equal to their URL, and each variant lists the same five hreflang alternates (en, fr, es, zh, x-default). The sitemap matches the indexable set exactly. llms.txt links resolve.
- **CSP and third parties:** every inline script in every page matches a hash in the CSP. No inline event handlers. No `innerHTML`, `eval` or `document.write` in `assets/js` or `tools`. Load-time requests go only to this origin; external URLs are `<a>` links (GitHub, huggingface.co, apache.org, modelcontextprotocol.io).
- **Middleware safety:** no open redirect (Location comes from the SHIPPED allowlist and `request.url`). No loop, since `/fr` is outside the matcher. Cookie values are allowlisted, and dropped-language cookies are cleared.
- **Build determinism:** two rebuilds, one from a different working directory, are byte-identical. The only date-derived output is `security.txt` Expires.
- **Locales:** 4 languages, 222 keys each. No em dashes, no exclamation marks in English, no "offline" in any language.
- **Assets and budgets:** all WebM files are under 1.5 MB, all posters under 60 KB, and every `<video>` has muted, playsinline, loop and preload="none". JS is 4.3 KB gzipped (budget 25 KB). Home first load is roughly 170-220 KB by estimate (budget 600 KB).

## Not verified

- Vercel runtime behaviour: how it resolves a 404 for nested unknown paths (for example `/fr/nope`), the order of `vercel.json` redirects versus middleware, and caching of pass-through responses. A Vercel docs search did not settle these, so I have not claimed them as findings.
- Lighthouse, CLS, WCAG contrast and 320px overflow (no browser available).
- The app-side items: `engineErrors.ts` slug parity, README links, the telemetry claim and the skill counts.
