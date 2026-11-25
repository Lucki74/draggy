# Competitor web design research: Ollama and Claude Code vs Draggy

Captured 2026-10-12 with Playwright (Chromium 141, headless, Linux). Desktop is 1440x900, mobile is 390x844. Light theme unless noted. Raw data is in `scratchpad/data/ollama-claudecode/*.json`, screenshots in `scratchpad/shots/ollama-claudecode/`, scripts in `scratchpad/scripts/ollama-claudecode/`.

## Method and caveats

- Pages: Ollama home (https://ollama.com/), Ollama download (/download), Ollama model library (/library), Claude Code product page (https://www.claude.com/product/claude-code), Claude Code docs entry (https://code.claude.com/docs, which resolves to /docs/en/overview), and Draggy at localhost:4173 (home, /download.html, /wiki/).
- Draggy's download page is `/download.html`. The brief's `/download/` returns 404 on the local preview and on https://draggy.org (see takeaway 3).
- Lighthouse is not installed, so no Lighthouse scores. Axe-core 4.10.2 ran with WCAG 2.x and 2.2 A/AA plus best-practice tags. "gzip est." is gzip -9 of each response body, not the CDN's compression, so treat it as an estimate.
- Timings come from a local headless browser with no throttling. Treat FCP, LCP and load as relative, not field data.
- Competitor content can change daily. Ollama's library in particular is dynamic.

## Cross-site numbers (desktop unless noted)

| Metric | Ollama home | Ollama download | Ollama library | Claude product | Claude docs | Draggy home | Draggy download | Draggy wiki |
|---|---|---|---|---|---|---|---|---|
| Requests | 17 | 5 | 7 | 88 | 116 | 14 | 8 | 8 |
| Transfer total | 224 KB | 208 KB | 1,235 KB | 3,859 KB | 2,123 KB | 1,290 KB | 148 KB | 224 KB |
| Transfer excl. video | 224 KB | 208 KB | 1,235 KB | 3,859 KB | 2,123 KB | 299 KB | 148 KB | 224 KB |
| Video loaded | 0 | 0 | 0 | 0 | 0 | 991 KB (3 webm) | 0 | 0 |
| JS transfer / gzip est. | 88 KB / 19 KB (1 file) | same | same | 799 KB / 739 KB (31 files) | 741 KB / 674 KB (39 files) | 13 KB / 4.1 KB (2 files) | 13 KB / 4.1 KB | 13 KB / 4.1 KB |
| Fonts | 0 | 0 | 0 | 6 files, 714 KB | 9 files, 537 KB | 1 file, 25 KB | 2 files, 64 KB | 1 file, 25 KB |
| Third-party hosts | none | none | none | analytics.tiktok.com, js.hs-scripts.com, js.hs-analytics.net, track.hubspot.com | cloudfront (13 req), fonts.googleapis.com (3), mintcdn.com (2) | none | none | none |
| Cookies after load | 1 (`aid`, 365 days) | 1 | 1 | 10 (incl. TikTok, HubSpot, `ajs_anonymous_id`) | 2 (Cloudflare) | 0 | 0 | 0 |
| FCP / LCP (ms) | 620 / 620 (P) | 380 / 380 | 684 / 684 | 1336 / 1336 (A) | 1296 / 1296 | 104 / 140 (video poster) | 148 / 148 | 132 / 132 |
| CLS | 0 | 0 | 0 | ~0 | 0.003 | 0 | 0 | 0 |
| Page height | 900 | 900 | 52,789 | 12,261 | 5,048 | 4,697 | 4,106 | 3,771 |
| Mobile transfer | 224 KB | 207 KB | 1,235 KB | 3,809 KB | 1,742 KB | 1,255 KB (270 KB excl. video) | 148 KB | 224 KB |
| Mobile page height | 1,000 | 844 | 57,637 | 17,166 | 7,449 | 6,030 | 5,242 | 4,057 |
| Horizontal scroll at 390 | no | no | no | no | no | no | no | no |
| Dark theme | none (identical white page) | none | none | yes (bg #141413) | yes | yes (bg #0e0e0e) | yes | yes |
| Gradients / blur / glow | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 2 gradients, 8 shadows, SVG filters | 10 gradient backgrounds, 1 shadow | 0 / 0 / 1 blurred shadow token | 0 | 0 |
| Running animations, default / reduced motion | 0 / 0 | 0 / 0 | 0 / 0 | 7 (3 infinite) / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Reduced-motion transfer | 223 KB | 207 KB | 1,235 KB | 2,066 KB | 1,846 KB | 382 KB (no video requested) | 148 KB | 224 KB |
| Axe, desktop (violations) | html-has-lang (serious), meta-viewport (critical) | same, plus scrollable-region on mobile | color-contrast (serious, 17), select-name (critical), html-has-lang, meta-viewport (critical), page-has-heading-one | aria-valid-attr-value (critical), color-contrast (serious, 10), target-size (serious), scrollable-region (serious) | color-contrast (serious, 24), region | heading-order, landmark-unique (both best-practice, moderate) | landmark-unique (best-practice) | landmark-unique (best-practice) |
| Controls under 24px (upper bound, includes inline links) | 9 of 17 | 9 of 21 | 9 of 263 | 22 of 191 | 90 of 169 | 5 of 49 | 16 of 44 | 4 of 59 |

Dark-run detail: Ollama's dark run has body text rgb(0,0,0) on transparent, and the screenshot is identical to the light one. Draggy's dark run uses bg rgb(14,14,14) and text rgb(242,242,242).

Notes on the table:
- Draggy home passes the stated budgets: under 600 KB excluding clips (299 KB), JS under 25 KB gzipped (4.1 KB est.), no horizontal scroll, no third-party requests, no cookies.
- Ollama home is 224 KB and its JS is 19 KB gzipped, which also fits Draggy's budgets. It has no third-party requests and one first-party cookie.
- Claude Code's product page is about 3.9 MB, with about 739 KB of gzipped JS, which is roughly 180 times Draggy's JS. It is the heaviest of the eight pages.
- Draggy home loads three clips on first load: hero (356 KB), research (314 KB) and code (345 KB). Two of those are below the fold. Under reduced motion, no clip is requested.

---

## Ollama

### Home (https://ollama.com/)

Section order (the page is one 900px screen; 93 elements, 5 sections):
1. Left column: H1, lead paragraph, CTA, stat row, logo wall. Right half: empty. The raw server HTML has no hero image, video, canvas or iframe, so the empty half is the design, not a failed load.
2. Footer row, pinned to the bottom of the viewport.

Copy, quoted:
- H1: "Ollama is the most popular way to build with open models."
- Lead: "Access the latest open models with complete privacy locally or in the cloud. Your prompts are never stored or trained on."
- CTA: "Get started" (href `/signup`).
- Stats: "9M+ installs a month", "1B+ model downloads", "200T+ tokens served". These are unverified claims on the page.
- Logo wall: Apple, NVIDIA, Microsoft, Meta, Adobe, Intel, NASA, Netflix, IBM, Nike, Visa, Mercedes-Benz. All grayscale at 50% opacity.

Product shown: nowhere on the home page. There is no screenshot or clip.

Social proof: the logo wall and the stat row. Trust signals: the privacy line and the "installs" and "tokens" counts. No checksums, no reviews, no compliance badges.

Nav: GitHub icon with "182.9K" star count, Download, Models, Docs (external to docs.ollama.com), Pricing, Sign in. The H1 is 22px, not much bigger than the 20px lead, so the hierarchy comes from weight and whitespace.

Footer: © 2026 Ollama, then one row of links: Blog, Docs, GitHub, Discord, X (Twitter), Support, Careers, Privacy, Terms (Meetups on mobile). The footer has no changelog link.

Mobile (390): hamburger menu, the same stack in one column, a logo grid of 3 columns, footer as two centred rows. No horizontal scroll.

Motion: none. No transitions, no animations, no reduced-motion rules.

Dark mode: none. Ollama has no dark theme at all.

### Download (https://ollama.com/download)

- Title changes with the user agent: "Download Ollama on macOS", "...on Windows", "...on Linux". Detection is server-side or at load. The active tab follows the user agent.
- Copy: H1 "Download Ollama"; lead "Get started by installing Ollama, or have your agent install it for you."
- Tabs: macOS, Linux, Windows (segmented control, 9999px radius).
- Commands: `curl -fsSL https://ollama.com/install.sh | sh` for macOS and Linux, `irm https://ollama.com/install.ps1 | iex` for Windows. One "Copy command" button per block.
- Second block, "Building with an agent?": a prompt of 1,849 characters behind "Show full prompt", with a "Copy prompt" button. The prompt tells an agent to read docs.ollama.com and install the CLI.
- Clicks to a working install: nav Download (1), copy (1), paste. No package managers, no checksums, no file sizes, no system requirements on the page.
- Layout: single column, text measure about 608px, code block with a light grey background and 12px radius.
- Mobile: same single column, the command truncates with an ellipsis, and the page is 844px tall.

### Model library (https://ollama.com/library)

- The document `<title>` is "library". The page has no H1; the H2s are model names.
- A llama face sits in the avatar block next to the "Library" heading. This is a mascot image, which Draggy's rules forbid.
- Search: "Filter models" input with a 9999px pill shape. A "Sort" select with no accessible name (axe critical).
- Each model is a row: H2 name, one-line description, tag chips (tools, thinking, 8b, 70b, 405b...), then a meta line ("120.2M Pulls", "93 Tags", "Updated 1 year ago"). Hairline dividers between rows.
- Tag chips use blue, indigo and cyan (Tailwind -600/-50 range), which breaks the page's grey palette. Axe flags 17 color-contrast failures on these chips.
- The page is one server-rendered list about 52,800px tall, with 7,086 elements and 843 KB of HTML. No pagination.

### What makes Ollama feel clean (measured, not impressionistic)

1. Empty space as a design element. The home's left column is capped near 576px, and the right half is blank by design. There are no cards, borders or background panels on the home.
2. Colour budget of one. Text is #000 or #171717, secondary text is #737373, and the background is white. The only colour appears in library tags. Logos are grayscale at 50% opacity.
3. One filled button per screen. "Get started" is the only filled button on the home. Other actions are plain text links.
4. No decoration. No shadows, gradients, icons beyond the logo and the GitHub glyph, or illustrations on the home.
5. System fonts. The font stack is `ui-sans-serif, system-ui`, so there are no font requests, no font swap and no layout shift. LCP is 620ms.
6. Short pages. The home fits one screen, and the download page is one control plus one code block.
7. Small weight. 224 KB total, one 88 KB script (htmx), one stylesheet of Tailwind output.

### What Ollama does badly (do not copy)

- Pill buttons (`border-radius: 9999px` on "Get started", the tabs and the library search). Draggy's rule is 12px maximum.
- The hero has no product image. A first-time visitor never sees the app on the home page.
- The second viewport meta, `maximum-scale=1`, blocks pinch-zoom (axe critical). The `<html>` element has no `lang` attribute. The library's sort select has no label.
- The library title "library" is not a useful title, and the page has no H1.
- Unverified claims and counts: "most popular", "9M+ installs a month", "200T+ tokens served", "never stored or trained on".
- Multi-colour tags and a mascot avatar on the library page.
- No dark theme.
- The "Copy prompt" block is a long instruction for an agent that is hard to scan, and it tells an agent to install the CLI on the user's behalf. Draggy's audience would expect a clear download instead.

---

## Claude Code

### Product page (https://www.claude.com/product/claude-code)

Section order, 12 sections plus a footer:
1. Hero (949px): H1 "Claude Code" with a serif display face. Lead: "Hand Claude a bug fix, test, or multi-day migration. Steer and review from your terminal, IDE, Slack, or web." Primary CTA "Download for Linux" (OS-aware: "Download for macOS" and "Download for Windows" under those user agents), secondary "Read documentation". Caption "Available for macOS, Linux, and Windows." An app-style panel on the right (about 845px wide) shows a realistic session. It is built from HTML and CSS (its text is live DOM, and the shell has blinking and spinning indicators), not a screenshot. Its text stays readable.
2. Surface tiles (row of eight 88x83 tiles, 12px radius): Terminal, Web, iOS, Android, GitHub, VS Code, JetBrains, Slack.
3. Customer logos in full colour: PagerDuty, Stripe, Intercom, Asana.
4. "Get started with Claude Code": Pro $17 per month, Max 5x, Max 20x, each with "Try Claude". Plan cards.
5. "Latest feature announcements": three blog cards plus "View changelog".
6. "What Claude Code can take on" with the one-liner `curl -fsSL https://claude.ai/install.sh | bash` and a "Get Claude Code" button.
7. "Meets you where you code": Terminal, IDE, Access anywhere, with the same one-liner.
8. "Kick off coding tasks in Slack": "Add to Slack" and "Learn more".
9. "What developers are saying": quotes from Ramp, Intercom and Notion, each with "Read story".
10. "Connects with your favorite command line tools".
11. FAQ with 8 questions (for example, "What are the system requirements to run Claude Code?" answered "Claude Code works on macOS, Linux, and Windows. See full...").
12. "Get the technical rundown": documentation and blog links.
13. Dark band: "Create what's exciting. Maintain what's essential.", newsletter sign-up and the one-liner again.
14. Footer: a 1,200px dark mega-footer with dozens of links in eight or more columns.

Header: logo; Product, Developers, Enterprise, Resources, Pricing (dropdowns); Login; "Contact sales" (outlined); "Try Claude" (filled black). A secondary bar reads "Claude Code" with "Explore here".

Typography (computed): body Anthropic Sans 15px/22.5px, lead 23px/34.5px in #5e5d59; H1 Anthropic Serif 64px/400; H2 52px/500; H3 32px/500; code 12.6px in a 5px-radius box.

Palette: background #faf9f5 (cream), ink #141413, muted #5e5d59, hairlines #e8e6dc. The root tokens define a full warm palette including clay #d97757 (the brand accent), cactus, sky, heather, plum, mineral and peach. The clay accent is in the logo and small details.

Radii: buttons 8px, tiles 12px, cards 16px, large docs card 24px. Max widths: container 1440px, text 640px.

Motion: 407 elements with transitions. On load there are 7 running animations, 3 of them infinite (two blinking row dots and a spinning spark in the hero shell, plus card-raise and nav slide-in on entry). Under `prefers-reduced-motion`, there are 36 reduced-motion rules and 0 running animations. Smooth scrolling is on by default and off under reduced motion.

Dark: `prefers-color-scheme: dark` swaps the page to #141413 background.

Mobile (390): no horizontal scroll, but the page is 17,166px tall with 3.8 MB transferred.

Clicks: the hero's "Download for Linux" goes to a docs page (`/docs/en/desktop-linux`), not a file. The one-liner on the product page is wrapped in a `<button>` element, so it is presumably a click-to-copy control. I did not test the clipboard. The docs quickstart shows a copy icon on its code block.

Performance: 88 requests and 3.86 MB; 31 scripts (799 KB transferred, 2.44 MB decoded, about 739 KB gzip est.), 184 KB of inline script (Next.js payloads), 6 Anthropic font files (714 KB), 22 images (142 KB). Third-party: TikTok (7 requests), HubSpot (3 hosts), with 10 cookies. The response has `content-security-policy-report-only`, not an enforced CSP.

### Docs entry (https://code.claude.com/docs, resolves to /docs/en/overview)

- Title "Overview - Claude Code Docs". Mintlify-style layout.
- Top nav: Getting started, Build with Claude Code, Plugins, Administration, Configuration, Reference, Agent SDK, What's New, Resources. Right side: Search (Ctrl K), "Ask Assistant", "Claude Developer Platform", "Open Claude Code" (filled).
- Left sidebar, grouped (Getting started, Core concepts, Use Claude Code, Platforms and integrations). Right "On this page" table of contents. "Copy page" button in the title row.
- Quickstart tabs: Terminal, VS Code, Desktop app, Web, JetBrains. Install code blocks: `curl -fsSL https://claude.ai/install.sh | bash` (macOS, Linux, WSL), `irm https://claude.ai/install.ps1 | iex` (PowerShell), and `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd` (CMD).
- Typography: Anthropic Sans body 16px, H1 Anthropic Serif Display 36px, code in Paper Mono 14px. Nine font files (537 KB).
- Performance: 116 requests, 2.1 MB; 39 scripts (741 KB transferred); 46 fetch requests (about 660 KB). Google Fonts is loaded (3 requests), which Draggy's CSP does not allow.
- Axe: 24 color-contrast failures on the sidebar's grey text (`text-gray-950/50`). A skip link and region warning.
- Dark theme: yes.

### What Claude Code does well

- The hero product panel shows the app large and readable, with a plausible session. The CTA is OS-aware.
- Install commands repeat in context (sections 6, 7 and 13), so the one-liner is always near a CTA.
- A serif display face for headings gives it an editorial voice. It is distinctive without decoration.
- Reduced motion is honoured thoroughly: 36 rules, no running animations.
- Clear tokens and dark mode (a full `:root` and `prefers-color-scheme` token set).
- Customer proof with named logos and quotes, and an FAQ that answers the common questions.

### What Claude Code does badly

- Weight: 3.9 MB on the product page, 740 KB of gzipped JS, 714 KB of fonts. Draggy's whole home is smaller than the product page's font bundle.
- Third-party trackers (TikTok, HubSpot) and 10 cookies on a marketing page, which contradicts Draggy's "no third-party requests" rule.
- Length: a 12,261px funnel. Some sections render blank in the full-page capture, probably scroll-triggered reveals I did not trigger. I did not verify this further.
- Accessibility: critical ARIA value errors, colour contrast failures on secondary text, and undersized footer controls.
- A 1,200px mega-footer.
- Multiple accent colours in the tokens, and eight product tiles that compete for attention.

---

## Draggy (current build, measured for comparison)

### Home (`/`, 4,697px desktop)

Sections in order:
1. Hero (819px): H1 "Web research and coding, with the model on your own computer." (56px, weight 600, tracking -1.12px). Subhead "No account. Your chats and files stay on your disk." OS-aware primary "Download for Linux" (direct link to the AppImage on GitHub Releases), "View source" (outlined). Size line "166 MB · Build 1". Licence line "Also for macOS and Linux · Free, Apache 2.0". Hero clip about 658px wide on desktop, 356px on mobile.
2. Values (169px): "Your files stay yours.", "Free, with no subscription.", "Open, all of it."
3. Features (1,730px): "The research.", "The code.", "The approval.", "The voice.", "The browser.", each with a clip (498px wide) and a caption.
4. "Will it run on mine?" hardware table (Older laptop 8 GB, Recent laptop 16 GB, Gaming graphics card 8 GB of video memory or more), graphics card FAQ, free disk note.
5. "Free to use." (no account, no subscription, cloud provider paid directly, Apache 2.0 licence link).
6. FAQ (4 questions).
7. Closer "Put it on your computer." with the download button again and "All systems and checksums".
8. Footer: Product, Docs, Project columns and a "Pause clips" button.

Typography: Geologica Variable (one 25 KB woff2). H2 40px/600; H3 20px/600; body 17px/28px; lead 20px/30px in #5e5e5e. Palette: #fff background, #111 ink, #e7e7e7 hairline, #b45309 accent (one accent). Dark: #0e0e0e background, #f2f2f2 ink, #fbbf24 accent. Radius: 8px buttons, 12px frames and cards. Shadow token `--shadow: 0 8px 30px rgba(0,0,0,.08)`.

Nav: Features, Models, Wiki, GitHub star icon (no count, consistent with the 25-star rule), English (switch to Français, Español, 中文), Download (filled).

Motion: 12 transitions of 0.15s; clips paused until played; reduced motion requests no clips.

Mobile (390): no horizontal scroll, hero stacks. The hero clip is 356px wide, which is roughly the full gutter.

Dark mode: works. Empty posters for the voice and browser dark clips (see takeaway 4).

### Download (`/download.html`)

- H1 "Download Draggy". Subhead "Free, with no account and no key to paste. Pick your system."
- Three OS cards at the top (Linux: AppImage, .deb; Windows: installer, 129 MB, Windows 10 64-bit 1809 or newer; macOS: Apple silicon and Intel, macOS 12 or newer).
- "Getting past the warning": explains that nothing is code signed yet, with per-OS instructions and `chmod +x` for the AppImage.
- "Checking a download": SHA-512 commands per OS (certutil, shasum -a 512, sha512sum), each with a copy button.
- "Every file" table with full SHA-512 values and sizes.
- "Build from source" with a link to the README.
- Clicks to a file: home hero (1, direct download) or nav Download then the OS card (2).
- Weakness: 16 controls under 24px (copy buttons measure 31x21px).

### Wiki (`/wiki/`)

8 requests, 224 KB, 325 elements, title "Wiki · Draggy". Axe reports only landmark-unique (best-practice).

---

## Top 10 takeaways for Draggy, ranked by impact

1. **Make the hero app readable.** At 1440px the hero clip renders at 658px, so the UI text is about 6px tall. Claude's product panel is about 845px and readable, and Ollama shows nothing. On desktop, widen the hero media toward the full 1120px wrap. On mobile, the clip already fills the 358px gutter, so re-record a tighter crop (for example, the chat pane only) rather than the full window. Rule-compliant: this is still the real app, shown larger.

2. **Turn the privacy claim into something checkable on the page.** Draggy measured 0 cookies, 0 third-party requests, and no analytics beyond Vercel's own. Claude's product page has 10 cookies and four third-party hosts (TikTok, HubSpot). Ollama has one first-party cookie. Add a line such as "No cookies. No third-party requests. Checked on the current release" and link to the method or the test. This is verifiable and the rules require it.

3. **Fix the bare `/download` and `/download/` 404s on draggy.org.** Production returns 404 for `/download` and `/download/`; only `/download.html` exists, and every link and the sitemap use it. Add permanent redirects in `vercel.json` (sources `/download` and `/download/`, destination `/download.html`). Anyone who types or shares the clean URL currently lands on an error page.

4. **Give every dark clip a poster.** All six dark clip variants have no `poster`. In the dark capture, the voice and browser tiles render as empty black rectangles until someone presses play. Light voice and browser also lacked posters in the default run. Generate `-dark.jpg` posters (the clips script in the app repo) and set the poster per theme.

5. **Protect the download facts block.** Draggy's download page is ahead of both competitors: Ollama shows one curl command with no checksum, size or requirements, and Claude's download CTA goes to a docs page. Keep the per-OS cards with sizes and requirements, the SHA-512 table and the unsigned-build explanation when the home is shortened. Ask whether any of this can be linked from the hero.

6. **Shorten the home, or stage the feature clips.** The home is 4,697px long with five stacked clip rows, and two of the three clips loaded on first paint are below the fold. A tab or segmented switch above one clip at a time would cut the default media load (about 1 MB), the page height and the blank-tile risk. Ollama does the pitch in one 900px screen, so this is a judgement call, not a rule.

7. **Remove the blurred shadow token.** `--shadow: 0 8px 30px rgba(0,0,0,.08)` is used on the app frames and sits against the "no blur, no glow" rule. Use the existing `--line` hairline (1px border, 12px radius) instead. Ollama's frames have no shadow, and Claude uses a 1px ring on its product card.

8. **Enlarge the copy and file-link hit areas on the download page.** Sixteen controls measure under 24px, including copy buttons at 31x21px and file names at about 19px. Axe passed them, probably because of the spacing exception in WCAG 2.5.8, but a 24px minimum hit area on each copy button is cheap and removes the doubt. Draggy's budget is WCAG 2.2 AA.

9. **Run axe in `npm test`.** Draggy currently has no WCAG A or AA violations under axe. Its two findings are best-practice (a heading-order jump from H1 to H3 in the values section and a non-unique landmark). Ollama fails `html-has-lang`, blocks zoom with `maximum-scale=1`, and has an unlabelled select. Claude fails ARIA values and contrast. A test keeps Draggy's pass rate without relying on review. Fix the H3 to H2 in the values section at the same time.

10. **Copy Ollama's restraint, not its look-alikes.** What makes Ollama clean: a text column capped near 576px, one colour family, one filled button per screen, no cards or shadows, a system font stack (no web-font requests), and short pages. Draggy already has most of this. Do not copy the pill buttons (`9999px`), the llama avatar, the grayscale logo wall, the unverified stat row, or the multi-coloured tag chips.

---

## Ollama and Claude Code: where Draggy's rules conflict with competitor patterns

- Pill buttons (Ollama): conflicts with the 12px maximum. Use 8px or 12px.
- Mascot avatar (Ollama library): conflicts with the no-mascot rule. Use the head logo only.
- Logo wall at 50% opacity (Ollama): Draggy shows no customer logos, which fits the "app is the picture" rule.
- HTML-built app shell with live animation (Claude product hero): Draggy's rules require real screenshots and screen-recorded clips, so the same effect would have to be a recorded clip.
- Blurred shadows (both): conflicts with Draggy's no-blur rule.
- Stat counts (Ollama): not measured on the current release, so cut them.
- Blog and changelog links (Claude): Draggy does not have a blog, but a changelog link to GitHub Releases is cheap and fits.

## Files

- Measurement harness: `scratchpad/scripts/ollama-claudecode/measure.cjs`
- Summaries: `scratchpad/scripts/ollama-claudecode/summarize.cjs` and `table.cjs`
- OS and CTA probes: `scratchpad/scripts/ollama-claudecode/download-flow.cjs` and `ua-cta.cjs`
- Raw data: `scratchpad/data/ollama-claudecode/` (one JSON per target, plus `ollama-download-flow.json`)
- Key screenshots in `scratchpad/shots/ollama-claudecode/`:
  - Ollama: `ollama-home-desktop-full.png`, `ollama-home-mobile-full.png`, `ollama-home-dark-full.png`, `ollama-download-desktop-full.png`, `ollama-download-mobile-full.png`, `ollama-library-desktop-seg01.png`
  - Claude Code: `claude-product-desktop-seg01.png` (hero), `claude-product-desktop-seg03.png`, `claude-docs-desktop-seg01.png`
  - Draggy: `draggy-home-desktop-seg01.png`, `draggy-home-dark-full.png`, `draggy-home-mobile-seg01.png`, `draggy-download-desktop-seg01.png`
