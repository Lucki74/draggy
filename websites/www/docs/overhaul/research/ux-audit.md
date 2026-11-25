# draggy.org UX, accessibility and performance audit

Date: 2026-10-12. Build audited: the existing `public/` output served on http://localhost:4173. The repo was not edited and `npm run build` was not run.

## Summary

The site is fast and stable. It has no layout shift, no horizontal overflow from 320px to 1440px, a good dark theme, a working skip link, visible focus, and clips that respect reduced motion. The worst problems are structural rather than cosmetic:

1. The wiki table of contents is hidden at every width up to 1366px, so phone and tablet readers have no way to see the other wiki pages.
2. The home page's macOS download button ships only the Apple silicon build, which Intel Mac visitors cannot run.
3. Wiki tables are clipped on phones and cannot be scrolled from the keyboard.
4. The clip player starts the wrong clip, and paused clips freeze on a blank frame.
5. The privacy policy describes storage that does not match the code.

## Method and scope

- 13 page and language combinations at 320, 390, 768, 1024 and 1440px in light and dark: 130 full-page PNGs in `shots/draggy/`. Pages were scrolled first so clip posters load. Cropped segments are in `shots/crops/`.
- Overflow, clipped-content and console probe on all 130 captures.
- axe-core 4.14.0 (WCAG 2.0, 2.1, 2.2 A and AA, plus best practice) on 20 page, width and theme combinations.
- Keyboard: tab order, focus ring, skip link, language menu, Escape, and target sizes at 390 and 1440px.
- Clips: autoplay, reduced motion, footer pause, per-clip play, expand dialog, theme variant.
- Performance: Chromium CDP byte counts, unthrottled, after a full scroll and on first load. Lighthouse 12.8.2 mobile and desktop presets on 9 pages.
- Not covered: `es` pages, fr and zh wiki and error pages, real devices, Safari and Firefox.
- Local-only artifact: the dev server returns 404 for `/_vercel/insights/script.js`. This accounts for the one console error on every page and for Lighthouse best-practices scoring 96. It is not a production defect.

Scripts are in `scripts/ux/` (`capture.cjs`, `axe.cjs`, `keys.cjs`, `clips.cjs`, `perf.cjs`, `firstload.cjs`, `lh-batch.sh`). Raw data is in `reports/`.

---

## High

### H1. Wiki navigation is hidden at every width up to 1366px
- **Where:** every `/wiki/*` subpage at 320 to 1366px, both themes, both languages. Evidence: `shots/draggy/en-wiki-installation-1024-light.png`, crop `shots/crops/wiki-inst-1024-top.png`.
- **What I saw:** `.wiki-nav` has `display: none` under `max-width: 1366px` (`assets/css/wiki.css` lines 124 to 133). That also hides its own `<details>` disclosure, although the comment above it says "disclosure on mobile". Verified with computed style: `display: none` at 390, 768, 1024 and 1366, and `block` at 1440. At 1024 the grid still reserves a 272px left column, so the article starts 320px from the edge with an empty column beside it. `site.js` `showCurrentWikiPage()` scrolls a sidebar row that does not exist on phones.
- **Fix:** below 1367px, show `.wiki-nav` as a full-width disclosure above the article, closed under 1024px and open from 1024px up. Use one column at those widths and do not reserve the nav column. Remove or correct the dead `showCurrentWikiPage` code.

### H2. The home page's macOS button sends Intel Macs an arm64 build
- **Where:** home page, all languages. The hero and the closing section both use `data-os-match="macos"`. Source: `tools/pages/_download.html` line 10.
- **What I saw:** with a Mac user agent, the hero button reads "Download for macOS" and links to `Draggy-arm64.dmg`. The download page says "The browser cannot tell an Apple silicon Mac from an Intel one, so both are offered", but the home page does not. Intel Mac visitors get a file they cannot run.
- **Fix:** on the macOS branch, link to `download.html#macos`, or show two buttons (Apple silicon and Intel) the same way the download page does. Apply the same change to `_download.html`.

### H3. Wiki tables are clipped on phones and cannot be scrolled from the keyboard
- **Where:** `/wiki/installation`, `/wiki/models`, `/wiki/providers`, `/wiki/settings` at 390px, light and dark. Evidence: `shots/draggy/en-wiki-installation-390-light.png` (crop `shots/crops/en-wiki-installation-390-light-00.png`), `shots/draggy/en-wiki-models-390-light.png`.
- **What I saw:** `.wiki-table` is `overflow-x: auto`, but its table has `min-width: 400px` inside a 332px box. Text is cut at the edge: "SmartScreen stops it. More inf", "GPT-OSS 20B (MoE". The wrapper has `tabindex="-1"`, so keyboard users cannot focus it and scroll it. axe reports `scrollable-region-focusable` as serious. Wiki pages also have 40px side gutters at 390px (content from x=40 to x=374), while the home page and wiki index use 16px.
- **Fix:** give `.wiki-table` `tabindex="0"`, `role="region"` and an `aria-label` naming the table. Reduce `.wiki-body` side padding to 16px below 640px. Below 640px, let cells wrap and drop the 400px minimum, or narrow the first column, so most tables fit without scrolling.

---

## Medium

### M1. The clip player starts the wrong clip
- **Where:** home page, 1440px light (also reproducible on phones when two clips are both at least half visible).
- **What I saw:** in `site.js`, every entry in the observer batch with `intersectionRatio >= 0.5` calls `start()`, which stops the others. The last entry in the batch wins, not the most visible one. Scrolling the `research` clip to centre left it fully visible but paused, while `code` (72% visible) played. Reproduced with `scripts/ux/clipdebug.cjs`.
- **Fix:** in the watch callback, collect the candidates, pick the one with the highest `intersectionRatio` (ties broken by distance from the viewport centre), start only that clip and stop the others.

### M2. Paused clips freeze on a blank frame
- **Where:** home page, all six clips, both themes. Evidence: `shots/crops/viewport-code-1440-light.png` (the code clip's paused frame is washed out; the poster is not shown).
- **What I saw:** frame 0 of every light `.webm` is pure white (mean 253, standard deviation 0, checked on the MP4 twins). The first 0.3 to 0.5 seconds are near-blank. Once a clip has loaded, the browser draws the current video frame, not the poster. So a clip paused by scrolling away or by the footer button shows a pale or blank frame. The posters themselves are fine: `code-light.jpg` shows the diff.
- **Fix:** trim the blank lead-in at encode time so that frame 0 has content, or keep the poster overlay visible until the `playing` event fires and hide the `<video>` until then.

### M3. Wiki check marks sit on the first letter of each item, and list indents are wrong
- **Where:** every wiki page with a `.ticks` list (installation, and others). Evidence: `shots/crops/zoom-wiki-checklist.png`, `shots/draggy/en-wiki-installation-1440-light.png`.
- **What I saw:** `padding-start` and `margin-start` are not CSS properties. `CSS.supports('padding-start', '24px')` returns false. So `.wiki-body .ticks li` gets 0px padding (`wiki.css` lines 226 to 233, and 213, 228) and the browser's 40px default indent applies. The disclosure chevron at `wiki.css` line 57 (`margin-start: auto`) also stays next to its label instead of moving to the end.
- **Fix:** use `padding-inline-start` and `margin-inline-start`. Set the `ul` indent to 0 for `.ticks` and give each `li` 24px inline-start padding so the tick sits in the gap.

### M4. On the download page at 390px, the "Every file" table loses its column labels
- **Where:** `/download.html` and the fr and zh equivalents at 320 to 640px. Evidence: `shots/draggy/en-download-390-light.png`, crop `shots/crops/en-download-390-light-02.png`.
- **What I saw:** `.builds-table thead` is `display: none` at 640px and below (`assets/css/pages.css` around line 261), and the cells carry no labels. Each row becomes a run of unlabelled values: "Windows / draggy_setup.exe / x64 / 129 MB / <hash>". A reader checking a checksum cannot tell which value is the hash.
- **Fix:** add a `data-label` to each `td` and show it at narrow widths with `td::before { content: attr(data-label) }`.

### M5. Download page targets are under 24px at 390px
- **Where:** `/download.html` at 390px (14 targets at 1440px). Evidence: `reports/keys.log`.
- **What I saw:** 15 targets are under 24px, which fails WCAG 2.2 2.5.8 because they are not inline text. The copy buttons are 31×21px. The file links are 19 to 22px high, including "Intel Mac", ".deb package" and "Draggy-arm64.dmg".
- **Fix:** give the copy buttons a 32×32px hit area and set `min-height: 24px` with vertical padding on the table links.

### M6. The footer pause button announces two states at once
- **Where:** footer, every page.
- **What I saw:** the label changes between "Pause clips" and "Play clips" and `aria-pressed` also flips. When paused, the label reads "Play clips" with `aria-pressed="true"`. A screen reader says "Play clips, toggle button, pressed", which describes the opposite of the state. Verified: `reports/keys.json` (`afterPause`).
- **Fix:** keep one constant name, such as "Clips" or "Pause clips", and let `aria-pressed` carry the state. Or drop `aria-pressed` and keep the changing label.

### M7. The privacy policy does not match the code
- **Where:** `/privacy-policy` and its fr, es and zh versions. Source: `tools/policy/*.html` line 57; `assets/js/site.js` lines 202 to 211.
- **What I saw:** the policy says two things are stored in the browser: "your theme, in local storage" and the language cookie. The site has no theme setting (it follows the OS) and stores no theme value. It does store `draggy-clips-paused` in `localStorage` when the footer button is used, and the policy does not mention that. AGENTS.md says "no cookies", which is also out of date: the site sets `draggy-lang`, which the policy does disclose.
- **Fix:** rewrite the storage paragraph in all four languages to list the `draggy-lang` cookie and the `draggy-clips-paused` key, and remove the theme sentence. Update AGENTS.md.

### M8. Wiki screenshots bypass the image pipeline
- **Where:** `/wiki/` and `/wiki/models/`.
- **What I saw:** wiki screenshots are plain `<img>` tags pointing at 1600×1000 PNG files, with no AVIF or WebP and no `srcset`. They display at about 624px. `app-settings-downloads-light.png` is 271 KB on `/wiki/models/`, and `app-mode-chat-light.png` is 114 KB on `/wiki/`. Neither file is listed in `assets/img/shots.json`, so `npm run images` never processes them. The home page's app shots go through `<picture>` with AVIF and WebP sources.
- **Fix:** add the wiki shots to `shots.json` so they are built as `<picture>` with AVIF and WebP at 800px and 1200px. `/wiki/models/` should drop from about 423 KB to well under 150 KB.

### M9. Clips are too small to read on desktop
- **Where:** home page, 1440px (the clip frame is 500px wide; at 390px it is 358px).
- **What I saw:** each 1280×800 recording is scaled to 39% at 1440px, so the app's text is unreadable except for headlines. These clips are the product's main visual.
- **Fix:** at 1024px and up, give the hero and code clips a full-width row or a 60/40 split. Keep the expand dialog as the way to read fine detail.

### M10. The language menu does not close on Escape
- **Where:** header language menu, all pages.
- **What I saw:** the menu is a native `<details>`. Enter opens it. Escape does not close it (`reports/keys.json`: `openAfterEsc: true`). A click outside does close it.
- **Fix:** add a small handler: when Escape is pressed while the menu is open, close it and move focus to the summary.

### M11. The language switcher's accessible name does not include its visible label
- **Where:** header language menu, all pages.
- **What I saw:** the visible text is "English", but the summary has `aria-label="Language"`. A voice user who says "English" cannot activate it. This fails WCAG 2.5.3 (Label in Name).
- **Fix:** remove the `aria-label` and add a visually hidden "Language: " before the visible name, so the accessible name is "Language: English".

### M12. The first viewport never says what Draggy is
- **Where:** home page, all languages, 320 to 1440px.
- **What I saw:** the H1 is "Web research and coding, with the model on your own computer." Above the fold the words "app" and "desktop" do not appear. "Free" appears only in the line below the buttons. Competitor folds (`shots/crops/compare-folds.png`) name their category or lead with a clear call to action.
- **Fix:** add one plain line naming the category, for example "Draggy is a free desktop AI assistant. No account, Apache 2.0." Check every claim against the app before publishing, as AGENTS.md requires.

### M13. At 1440px the wiki index shows the whole nav above its title
- **Where:** `/wiki/` at 1367px and up, both themes.
- **What I saw:** the full 17-link navigation (about 870px tall, expanded by default) sits above the page title and the cards. The H1 starts near y=940 (`shots/draggy/en-wiki-index-1440-light.png`).
- **Fix:** on the index page, render the nav closed, or move it into the left column as it is on subpages.

---

## Low

### L1. Heading order and duplicate nav names
- **Where:** home page (heading order), every page (landmark names).
- **What I saw:** the three value headings are `h3` with no `h2` before them. axe reports `heading-order` (moderate), and Lighthouse fails the same audit. The header and footer both use `<nav aria-label="Product">`, which axe reports as `landmark-unique`.
- **Fix:** style the value titles as `p`, or add an `h2`. Rename the footer nav to "Footer".

### L2. The header is cramped at 320 to 390px
- **Where:** all pages, header.
- **What I saw:** brand, Wiki, star, language and Download touch, with 0 to 2px between them (`scripts/ux/headerprobe.cjs`). In French, "Draggy" and "Wiki" nearly collide (`shots/crops/hdr-320-all.png`).
- **Fix:** hide the star below 360px and set 12px gaps between items.

### L3. The Chinese hero headline breaks inside 编程
- **Where:** `/zh/`, 320 to 390px (`shots/crops/zh-home-390-light-00.png`).
- **What I saw:** the line ends with "编" and the next begins with "程", splitting one word.
- **Fix:** wrap 编程 in a `nowrap` span in the zh headline.

### L4. The version is shown only as "Build 1"
- **Where:** home and download pages, all languages.
- **What I saw:** the release is 3.0.1 (`release.json`, and `softwareVersion` in the JSON-LD), but the page shows only "Build 1". A visitor cannot match that to a release.
- **Fix:** show "Version 3.0.1 (build 1)" and link the release notes next to it.

### L5. On phones, the main button is "Copy link"
- **Where:** home page, hero and closing section, with a phone user agent.
- **What I saw:** the only primary button on a phone is "Copy link". It does little for a visitor who cannot install the app on that device.
- **Fix:** make "Copy link" secondary and add a short line such as "Open this page on your computer to download".

### L6. Ghost-button and icon-control borders are faint
- **Where:** "View source", copy buttons and clip controls.
- **What I saw:** the `--line` border (#e7e7e7) on white is 1.24:1. The labels still identify the controls, so this is not a clear WCAG 1.4.11 failure, but the controls look faint.
- **Fix:** use `--muted` (#5e5e5e, 6.5:1) for the borders of ghost and icon-only controls.

### L7. Download button labels are vague
- **Where:** download page cards.
- **What I saw:** the buttons read "AppImage", "Installer" and "Apple silicon". The file type is shown elsewhere in the card.
- **Fix:** "Download AppImage", "Download installer (.exe)" and "Download for Apple silicon (.dmg)".

### L8. The hero repeats its platform line
- **Where:** home page hero.
- **What I saw:** "Also for macOS and Linux" repeats what the OS-specific button already shows.
- **Fix:** hide that line when the OS-specific button is shown.

### L9. The wiki has no search
- **Where:** all wiki pages.
- **What I saw:** there are 17 pages and no search box. The index cards are the only overview.
- **Fix:** add a client-side title search over a small JSON index, or accept it and rely on the index.

### L10. Wiki index card descriptions are underlined
- **Where:** `/wiki/` cards.
- **What I saw:** the whole card is a link, so the description text is underlined and reads like a set of links.
- **Fix:** remove the underline from the card description.

### L11. Empty space on the download page
- **Where:** download page, before "Every file" and "Build from source" (about 200px each).
- **Fix:** reduce the top margin of sections that follow the accordion.

### L12. The wiki pager's first label is "Previous Wiki"
- **Where:** first wiki page's pager, which points to the index.
- **Fix:** label it "Back to wiki".

---

## Measured numbers

Weight and requests are Chromium CDP byte counts after a full scroll, so they include the clips that autoplay. "Excl. clips" subtracts clip videos and posters. LCP (local) is unthrottled. Lighthouse columns use the mobile preset (simulated 4G and 4× CPU) unless marked desktop. CLS was 0.000 on every page, including after the scroll.

| Page | Width | Weight KB | Excl. clips KB | Requests | LCP local ms | LCP Lighthouse ms | Lighthouse perf |
|---|---|---|---|---|---|---|---|
| en home | 390 | 1986 | 382 | 18 | 132 | 1958 | 99 |
| en home | 1440 | 1986 | 382 | 18 | 120 | 441 (desktop) | 100 (desktop) |
| en download | 390 | 148 | 148 | 7 | 132 | 1953 | 99 |
| en download | 1440 | 148 | 148 | 7 | 100 | 447 (desktop) | 100 (desktop) |
| en wiki index | 390 | 224 | 224 | 7 | 104 | - | - |
| en wiki index | 1440 | 224 | 224 | 7 | 68 | - | - |
| en wiki installation | 390 | 149 | 149 | 8 | 112 | 2108 | 99 |
| en wiki installation | 1440 | 149 | 149 | 8 | 140 | - | - |
| en wiki models | 390 | 423 | 423 | 8 | 96 | 2181 | 98 |
| en wiki models | 1440 | 423 | 423 | 8 | 144 | - | - |
| en privacy | 390 | 144 | 144 | 7 | 120 | 2103 | 99 |
| en privacy | 1440 | 144 | 144 | 7 | 88 | - | - |
| en 404 | 390 / 1440 | 100 | 100 | 6 | 76 | - | - |
| en error index | 390 / 1440 | 106 | 106 | 6 | 76-84 | - | - |
| en error (out of memory) | 390 / 1440 | 141 | 141 | 7 | 64 | - | - |
| fr home | 390 | 1988 | 384 | 18 | 160 | 2102 | 99 |
| fr home | 1440 | 1988 | 384 | 18 | 316 | - | - |
| fr download | 390 / 1440 | 149 | 149 | 7 | 104-120 | - | - |
| zh home | 390 | 1987 | 382 | 18 | 188 | 2105 | 98 |
| zh home | 1440 | 1987 | 382 | 18 | 168 | - | - |
| zh download | 390 / 1440 | 148 | 148 | 7 | 228-256 | - | - |

First load on the home page, before any scroll:
- 390px: 506 KB in total, including 348 KB of hero video. Without clip video or posters it is 120 KB, against a budget of 600 KB.
- 1440px light: 553 KB in total. Dark: 562 KB.

Assets:
- `site.js`: 12.6 KB raw, 4.3 KB gzipped (budget 25 KB).
- `site.css`: 3.2 KB gzipped. `home.css`: 1.2 KB gzipped.
- Fonts: Geologica 24.5 KB. JetBrains Mono 40 to 64 KB, loaded only on pages with code.
- Clip videos: 307 to 437 KB per WebM (limit 1.5 MB). Posters: 35 to 60 KB (limit 60 KB).

Lighthouse, all 9 pages: accessibility 98 to 100, SEO 100, best practices 96 (the local analytics 404 described above). Failing audits: `heading-order` on the home page only.

---

## What passes

- No horizontal overflow and no clipped fixed boxes across the 130 captures, 320 to 1440px, both themes, all languages probed.
- CLS is 0.000 on every page, including after a full scroll.
- Lighthouse mobile performance is 98 to 99 and desktop is 100. Home LCP is 1.96s mobile (simulated) and 0.44s desktop.
- Home first load stays within budget, and the clip rules are met: WebM under 1.5 MB, posters under 60 KB, `muted playsinline loop preload="none"`, no autoplay under reduced motion, the footer button pauses all clips and holds, each clip's own play button still works after a footer pause, the light and dark takes match the theme, and the expand dialog closes with Escape.
- The skip link works, tab order is logical, and focus is visible in both themes (light #b45309 at 5.0:1, dark amber at 11.6:1).
- No JavaScript errors and no third-party requests other than Vercel's own.
- Dark mode is well handled, and the 404, error and privacy pages read clearly.
- The download page is honest about missing code signing and gives clear checksum commands.

## Against the competitor folds

Draggy's first fold is calmer and reads like a product page. Hermes uses a large poster-style hero, and Kilo's first screen is covered by a cookie banner (`shots/crops/compare-folds.png`). Draggy's weak point is not the visual style. It is that the first screen never names the product category (M12), and the one real visual, the app clip, is small at desktop width (M9).
