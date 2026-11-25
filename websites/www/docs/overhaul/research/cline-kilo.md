# Competitor web design review: Cline, Kilo Code, and Draggy (draggy.org)

Captured 2026-10-12 with Playwright (Chromium 141, headless). Viewports 1440x900 and 390x844. Draggy was audited on the local build at http://localhost:4173.

Sites:
- Cline: https://cline.bot (home, /install, /desktop, /models, /cline-pass, docs.cline.bot)
- Kilo Code: https://kilo.ai (kilocode.ai returns 308 to kilo.ai; home, /install, /pricing, /open, /cli, /docs)
- Draggy: http://localhost:4173 (home, /download.html, /wiki/)

## Method and caveats

- The proxy relay dropped connections on bursts of parallel requests. Some first runs had 502s and CSS served as text/plain, which broke fonts and layout (for example, Kilo's headings fell back to Times New Roman). Clean runs were used for every reported figure. Kilo's clean capture used route-level retries (`ROUTE_RETRY=1` in the audit script), which decompresses response bodies. Byte totals from those runs are therefore inflated, so transfer sizes for JS and CSS were re-measured with curl and gzip against the same URLs.
- Cookie banners appeared in our headless sessions. They may be region-dependent.
- Full-page captures of scroll-reveal sections can come out blank if the scroll is too fast. The Kilo FAQ band was blank in the first capture. A slow-scroll recapture confirmed the content renders (opacity 1, no transform).
- Lighthouse was not run. All performance figures are from Playwright, curl and gzip.
- Draggy timings are localhost, so they are not comparable to remote timings. Use the byte counts and request counts instead.

Screenshots: `scratchpad/shots/cline-kilo/`. Desktop full-page images are sliced into `chunks/`. Mobile is in `*-mobile-tiled.png`. Raw data: `scratchpad/data/*.json`. Scripts: `scratchpad/scripts/cline-kilo/`.

## Cline (cline.bot)

**Nav and footer.** Header items: Desktop, Cloud, IDE, CLI, SDK, ClinePass, Docs (docs.cline.bot), More, Sign In, and a black GitHub button showing "70k". Footer: four columns (Product, Community, Support, Company), a newsletter email form ("Stay updated on Cline's evolution"), and social icons. The footer lists Discord, Reddit, GitHub Discussions, Issues, Careers, Brand, Terms and Privacy.

**Home page, section by section (desktop, 5,529px):**
1. Announcement bar: "NEWS Introducing Cline for Desktop - Open source desktop app for open weights models" with "Learn More". It is fixed and overlaps the header at the top of the fold.
2. Hero: H1 "The Open Agent" (72px DM Sans, purple). Subhead "Ship securely w/ Grok in JetBrains". This rotates: a later load showed "Kimi in VS Code". Body: "One open source agent runtime. Use it in your editor, your terminal, or embed it in your own products. Trusted by 11M+ developers."
3. Product switcher: tabs Desktop (NEW), CLI, IDE Extension, SDK. The Desktop tab shows "Download for Mac / Windows / Linux" buttons and "v0.0.45 · macOS, Windows & Linux". The Mac and Windows buttons link straight to GitHub release binaries; Linux is a dropdown.
4. Hero art: a large ASCII-art robot head with labels "Automate", "Understand", "Refactor". This breaks Draggy's rule against ASCII art and mascots.
5. Stats strip: "70.2k stars". Mobile shows "11M+ installs across all platforms".
6. Logo wall: "Trusted by developers and leaders at" with Samsung, Salesforce, Oracle, Amazon, LG, Globant, Microsoft, eBay, Visa, IBM. This is social proof by logo.
7. "See Cline at work": H2 (48px, Space Grotesk), tabs Understand / Refactor / Automate, one real VS Code screenshot, three short feature blurbs. This is the rule-compliant pattern to copy.
8. Trust strip: "Built with the model labs · 250+ contributors · Apache 2.0 open source".
9. "Everything an agent should do, in your editor and your terminal." Sub: "Open source. Plan-and-Act. Every model. No vendor lock-in." Eight features in a two-column list with purple square bullets. No screenshots.
10. "Any model, your infrastructure": "Cline works with every major provider. Bring your own key, your own endpoint, or your own weights and keep your workflow exactly the same." Provider logo grid. In one desktop run, the xAI and Cerebras logos showed as broken images with alt text.
11. Closing CTA: "Ready to experience AI coding without limits?" with a square black "Get Started" button linking to /install.

**Install flow.** /install redirects to the VS Code Marketplace listing for the extension (VS Code Marketplace listing shows 5,601,632 installs). The desktop app uses direct GitHub release downloads. Docs show the CLI as `npm i -g cline`.

**Open source and BYO-model messaging.** "Open source" appears in the hero copy, the trust strip, and the footer. There is no open-source page: /open-source returns 404. BYO-model messaging is "Bring your own key, your own endpoint, or your own weights", plus the logo grid.

**Pricing.** ClinePass at $9.99/month for open-weight models (/cline-pass). Its download buttons link to v0.0.38, while /desktop and the home page link to v0.0.45. The versions are out of sync across pages.

**Docs.** docs.cline.bot is a Mintlify-style docs site with Ctrl-K search, a sidebar (Applications, Model access, BYOK), and 12px button radii.

**Typography and style (computed).** Body DM Sans 18px / 27px, #151516 on #F8FAFB. Headings: DM Sans 72px (H1), Space Grotesk 48-50px (H2). Inter is also loaded (three families). Accent purple rgb(159,88,250). Buttons 9px radius, except the black "Get Started" which is square (0px). Container widths 1400-1530px. About 20 inline SVG icons. Palette is white and near-black with purple accents, and a dark footer.

**Dark mode.** No change under prefers-color-scheme: dark in our test. The page stays white. The footer is dark regardless.

**Motion.** One reduced-motion media rule. About 7-8 CSS transitions run at load under both normal and reduced emulation, so reduced motion does not suppress them.

**Mobile (390px).** Works after a clean re-run: hamburger menu, a two-column logo grid with gutters, and a stacked footer. The cookie bar covers roughly the bottom 190px of the fold. No horizontal scroll.

**Performance (desktop first run; mobile clean re-run).**
- Desktop: 152 requests, about 2.4 MB transferred. Scripts 1.48 MB encoded, images 455 KB, fonts 197 KB, CSS 56 KB. DOMContentLoaded 1.10 s, load 2.33 s, LCP 5.46 s, CLS 0.176.
- Mobile re-run: 141 requests, 2.1 MB. DCL 0.98 s, load 1.78 s, LCP 1.52 s, CLS 0.056.
- JS gzipped via curl: about 1.44 MB across 47 scripts. About 0.81 MB of that is third-party: Google Tag Manager, Google Ads, Meta Pixel, HubSpot (analytics, forms, banner), Reddit, LinkedIn, X and Unifyintent.

**Cookie banner.** A bottom bar: "We use cookies to enhance your experience, analyze traffic, and personalize content." It offers Decline Non-Essential, Manage Preferences and Accept All. It covers the bottom of the fold.

**Does well:** shows the product in tabbed use cases, gives direct OS download buttons, has a clear docs site, uses a short trust strip, and the mobile logo grid is clean.

**Does badly:** ASCII art in the hero, rotating hero copy, a heavy third-party tag stack, cookie bar over the fold, a newsletter form, broken logo images in one run, a 404 for the open-source page, out-of-sync version links, and a LCP and CLS that were poor on desktop in our run.

## Kilo Code (kilo.ai)

**Nav and footer.** Header: logo, GitHub icon, Product, Models, Enterprise, Resources (all with dropdowns), Pricing, Sign in, and a yellow "Get Started". Sign in and Get Started go through `kilo.ai/api/impact/redirect` (an affiliate redirect to app.kilo.ai). The footer is very large: about 60-70 links in eight columns, including "vs Cline", "vs Cursor" and similar comparison pages, plus Community, Models, Enterprise, Resources, Company, Legal, Trust Center, and "Made with ❤️ in Amsterdam".

**Home page, section by section (desktop, 8,852px):**
1. Announcement bar (yellow): "Anaconda launches new capabilities across the AI Dev Factory starting with Kilo Desktop · Read the launch".
2. Hero: H1 "One open agent for every developer workflow" (60px, Geist Mono 500). Sub: "500+ models, zero markup: frontier, open weight, or your own keys. One fully open-source agent everywhere you work: a free AI agent for VS Code and a free AI coding agent for the terminal."
3. Product card grid: Kilo Desktop (BETA) with a cropped app screenshot and "Download for Linux" plus "Also for macOS · Windows". VS Code card with "Install extension" (a `vscode:extension/kilocode.kilo-code` deep link, plus an Open VSX link). JetBrains card with "Get plugin". CLI card with a `curl -fsSL https://kilo.ai/cli/install | bash` line, package-manager tabs (curl, npm, pnpm, bun, brew, paru) and a copy button. Cloud ("Try Cloud free"), Slack ("Add to Slack"), and Mobile ("Get the app" with a QR code).
4. Cookie sheet: a Transcend dialog with Accept all / Reject all, sitting over the lower half of the hero on desktop. On mobile it covers the Desktop card.
5. Social proof: "Trusted by developers at the world's most innovative companies" with Meta, Amazon, Airbnb, PayPal, Square, Red Hat. Three stat cards: "#1 Open Source Product of the Month", "5M+ Kilo Coders", "10T+ tokens processed every month", with yellow glowing borders.
6. "Built differently, on purpose." Sub: "AI coding tools should work for you, not against you." Three cards: "One portal for every agent", "Models at cost. No markup. No lock-in.", and "No black boxes. Inspect everything." Each has three checks and a yellow link.
7. Strip: "Your agents should move with your work." Chips VS Code, CLI, Cloud, Slack.
8. "Use Kilo Everywhere": an 11-cell grid of surfaces (Desktop, VS Code, JetBrains, IntelliJ, PyCharm, WebStorm, CLI, Cloud Agents, Slack, Code Reviewer, Gateway).
9. "Built for agentic engineering" / "Multiple agents, one platform": tabs Ask, Plan, Code, Debug, Custom, plus a native video (0:16, controls, not autoplaying) and five feature bullets.
10. "Stop choosing models. Start shipping." Auto Model card with Efficient / Frontier / Free tiles, a gradient border and a yellow button.
11. A floating mid-page pill: "Start With Kilo Auto Free - No Credit Card required".
12. "Recent posts": six article cards with bylines and dates (Oct 2 to Oct 12, 2026), plus three yellow text links ("Explore AI model rankings", "Compare Kilo pricing", "Browse the Knowledge Base").
13. FAQ accordion: about 16 questions, including "Is Kilo Code really open source?" and "Does Kilo support MCP?".
14. Closing: "Ready to get started?" with "Start Coding Free" and "Talk to sales".

**Install flow.** The most direct one-click install of the three sites: the "Install extension" button is a VS Code deep link (`vscode:extension/kilocode.kilo-code`). The Linux desktop download points to `autoupdate.desktop.anaconda.com`, a third-party CDN. The CLI uses a one-line curl installer with a copy button, and the install page offers npm, pnpm and bun variants.

**Open source messaging.** Dedicated page /open, H1 "Kilo Speed is open" (72px, JetBrains Mono). Sections "What Open Means at Kilo" and an FAQ. It separates MIT-licensed clients (VS Code, JetBrains, terminal) from source-available parts and hosted services, and says "Concrete, verifiable commitments. Not marketing speak." Also on the home page: "Open Source Product of the Month", "OPEN SOURCE" card, GitHub repo links, and a "27.6k" GitHub count in the header (shown on the first run, not in the clean run).

**Local and BYO-model messaging.** "500+ models, zero markup", "Bring your own keys", "Local models supported", "Local Models" and "Open-Weight Models" pages in the footer, plus "Models at cost. No markup. No lock-in." /pricing says "AI inference stays at provider rates with no markup."

**Pricing (/pricing, 1,121 words).** "Free & Open Source" plan, Teams at $15 per user per month with a 14-day Enterprise trial, Enterprise custom. Includes a Kilo Pass calculator, a compare table, and a pricing FAQ.

**Docs.** /docs ("Kilo Documentation", 48px) has "Browse by topic", a yellow "Get started with Kilo Code" button, and install commands. /cli has a 96px H1 "Open Source CLI Coding Agent".

**Typography and style (computed).** Body JetBrains Mono 16px / 24px, rgba(255,255,255,0.9) on #0A0A0A. H1 Geist Mono 60px. H2 JetBrains Mono 48px weight 800. Cards in Hanken Grotesk. Accent #FFDD00 (yellow), used on buttons and text. Container widths 1152-1536px. Radii: 8px, 4px, 14px and 6px on buttons and cards, and 18 full pills on tags and badges (9999px). About 129 inline SVG icons (Lucide-style plus codicons).

**Dark mode.** The site is dark-only. Under light emulation the background stays #0A0A0A, so there is no light theme.

**Motion.** Three reduced-motion rules. Under reduced motion the spinner is removed but the "ping" live-dot animation keeps running. The mobile run has 22 gradient backgrounds, 77 box-shadows (glow), 2 pill buttons and 3 blur filters.

**Mobile (390px).** Hamburger menu. The hero stacks seven product cards between the intro and the "Built differently" section. The cookie sheet covers the Desktop card. Feature sections follow, then a long footer. No horizontal scroll.

**Performance.**
- Desktop (route-retry run): 99 requests. DCL 0.95 s, LCP 4.1 s (H1), CLS 0, load 8.9 s (inflated by route re-fetches).
- Mobile (route-retry run): 100 requests. DCL 0.68 s, load 1.24 s, LCP 2.1 s, CLS 0.
- JS gzipped via curl: about 1.0 MB across 58 scripts (about 0.86 MB first-party, 0.16 MB Transcend). Some relay failures are counted as 0, so the true figure is higher. Also loads posthog-recorder.js and surveys.js via kilo.ai/ingest (PostHog session recording, surveys, dead-click autocapture), and a 480 KB Lottie WebAssembly file from jsDelivr (uncompressed size in our run).
- CSS about 48 KB gzipped (3 files). Fonts about 230 KB (6 files; JetBrains Mono, Geist Mono, Hanken Grotesk, codicon).

**Does well:** a strong product grid that shows every surface, a copyable CLI install, a real open-source explainer, and a long, honest FAQ. The first-run stats are distinctive.

**Does badly:** the cookie sheet covers the hero on desktop and mobile. The dark-only theme, yellow glow cards, gradients and pills conflict with Draggy's rules. The footer is bloated, with comparison-page SEO links. Unverifiable stats ("#1", "5M+", "10T+") and a logo wall are weak trust signals. The affiliate redirect on CTAs and PostHog session recording are privacy costs. Mobile product cards push the value statement far down.

## Draggy (local build, http://localhost:4173)

**Nav and footer.** Header (65px, sticky): logo, Features, Models, Wiki, a GitHub star icon (no count shown), language links English / Français / Español / 中文, and a black "Download" button. Footer: Product (Features, Models, Download), Docs (Wiki, Installation, Troubleshooting, Privacy), Project (Source, Releases, Issues), the Apache 2.0 line, and a "Pause clips" button.

**Home page, section by section (desktop, 4,697px):**
1. Hero: H1 "Web research and coding, with the model on your own computer." (56px, Geologica Variable 600; 36px on mobile). Sub: "No account. Your chats and files stay on your disk." CTAs: black "Download for Linux" and outline "View source". Meta line "166 MB · Build 1". Line: "Also for macOS and Linux · Free, Apache 2.0". Real app clip, about 600px wide on desktop.
2. Three points: "Your files stay yours." / "Free, with no subscription." / "Open, all of it." Each one or two sentences.
3. Feature blocks, alternating text and real clips: "The research." "The code." "The approval." "The voice." "The browser." Each has a one-line sentence and a text link (How research works, Coding in Draggy, Permission modes, Talk mode, Built-in browser).
4. "Will it run on mine?" H2 with a plain hardware table: Older laptop 8 GB (small models chosen by Draggy to fit), Recent laptop 16 GB (mid-size), Gaming graphics card 8 GB VRAM or more (runs on the card, from Qwen 3.5 9B upward). Also: "Do I need a graphics card? No." and "Plan for 10 GB of free disk for a typical model."
5. "Free to use." "No account, no subscription. If you add a cloud provider, you pay that provider directly." Link: Apache 2.0 license.
6. "Questions": four accordion items (Is Draggy free? / Does it need the internet? / Can I use ChatGPT, Claude or Gemini with it? / What leaves my computer?).
7. Closing: "Put it on your computer." with Download for Linux, View source, "All systems and checksums".

**Download page (/download.html).** Sections for Windows, macOS and Linux with installers (Windows setup, Apple silicon and Intel .dmg, AppImage, .deb). Includes "Getting past the warning" (xattr and chmod commands for unsigned builds), "Checking a download" with SHA-512 commands (`certutil`, `shasum`), an "Every file" list, and "Build from source". The nav link is download.html. The brief referred to /download/, which returns 404 on the preview server.

**Wiki (/wiki/).** H1 "Wiki" (40px). Sections: Getting started, Working in a project, What it can do, Day to day, Working on Draggy.

**Install flow.** The download page is the install flow: direct GitHub release assets for each OS, with checksums, plus the warning guidance. The home page offers only the Linux primary button, with the other platforms named in small text.

**Open source and privacy messaging.** "Open, all of it." "Read the code, build it yourself, change it." "Apache 2.0 license" link. The footer says it is open source under Apache 2.0 with no warranty. The description claims "no account and no telemetry", which should be checked against the app.

**Typography and style (computed).** Body Geologica Variable 17px / 28px (16px / 26px on mobile), #111 on #FFF. H1 56px (36px mobile), H2 40px (28px mobile), H3 20px. Content max-width 1168px, text 640px. Radii 8px for most buttons, 12px for a few, 6px for language chips. Palette: #111 text, #5E5E5E secondary text, #E7E7E7 borders, #FFF background. No accent colour appears in the home page's computed styles. About 26 inline SVG icons.

**Dark mode.** Works. Under prefers-color-scheme: dark the background is #0E0E0E and the text #F2F2F2.

**Motion.** Zero CSS animations on the home page. Clips are muted, loop, `preload="none"` and have posters. One reduced-motion media rule. A pause control sits in the footer.

**Mobile (390px).** Clean: H1 36px, Download button visible above the fold, hero clip about 350px wide, no horizontal scroll, consistent gutters, and the same section order as desktop.

**Performance.**
- Home: 16 requests. Non-video first-load weight is about 342 KB: HTML 62 KB raw (13.6 KB gzipped), CSS 16 KB raw (about 4.3 KB gzipped), JS site.js 12.9 KB raw (4.3 KB gzipped), one 25 KB woff2 font, and about 226 KB of images. This is under the 600 KB budget.
- Four clips (1.16 MB) were pulled in by our scroll pass. With `preload="none"` they should load only on play, so a normal visit should not fetch them.
- The console error is `/_vercel/insights/script.js` returning 404. That is Vercel Web Analytics, which exists only on Vercel deploys, so it is expected locally.
- Local timings: DCL 86 ms, load 119 ms, LCP 240 ms (hero poster), CLS 0.

**Does well:** lightest page of the three (16 requests, no third-party requests, under 5 KB gzipped JS), zero layout shift, honest hardware guidance, real checksums and unsigned-app guidance, four languages, a working dark mode, and no cookies or consent UI. It also avoids pills, gradients, glow and ASCII art.

**Does badly:** no accent colour on the home page, so the "one accent" rule is not visible. The hero line "Also for macOS and Linux" omits Windows, which download.html offers. The hero clip is modest in size (about 600px on desktop). It has no social proof, which is intentional but leaves the page without a credibility line beyond the license. The blank frame for the "Built-in browser" clip in our full-page capture is most likely a lazy-load artifact (the poster file exists at 48 KB). Recheck it in a real visit.

## Side-by-side summary

| | Cline | Kilo Code | Draggy |
|---|---|---|---|
| Home height, desktop / mobile | 5,529 / ~7,250 px | 8,852 / 14,928 px | 4,697 / 6,030 px |
| Requests (home, desktop) | 152 (first run) | 99 | 16 |
| JS gzipped (home) | ~1.44 MB (~0.81 MB third-party) | ~1.0 MB (incl. PostHog, Transcend) | 4.3 KB (site.js) |
| Third-party requests | GTM, Google Ads, Meta, HubSpot, Reddit, LinkedIn, X | PostHog via /ingest, Transcend, Impact affiliate redirect, jsDelivr | None (Vercel analytics is same-origin) |
| Cookie or consent UI | Bottom bar over the fold | Sheet over the hero | None |
| Theme | Light only (dark footer) | Dark only | Light, with working dark mode |
| Accent | Purple (~#9F58FA) | Yellow (#FFDD00) | None on home |
| Body font / size | DM Sans 18 / 27 | JetBrains Mono 16 / 24 | Geologica 17 / 28 |
| H1 size (desktop) | 72px | 60px | 56px |
| Button radius | 9px (black CTA square) | 4-8px, plus pills | 8px |
| Pills | Stat chip | Badges, floating CTA, 2 pill buttons | None |
| Gradients / glow | None | 22 gradients, 77 shadows (mobile run) | None |
| Motion, reduced | 1 rule, transitions remain | 3 rules, spinner stops, ping stays | 1 rule, 0 animations at load |
| Forms | Newsletter in footer | None seen | None |
| Install | Marketplace listing; GitHub binaries | VS Code deep link; curl script; OS downloads | OS downloads with checksums; download.html |
| Languages | English | English | English, French, Spanish, Chinese |

## Top 10 takeaways for Draggy (ranked by impact)

1. **Make the hero download OS-aware and list all three platforms.** Cline's hero switcher and Kilo's product grid both put per-OS downloads in the first fold. Draggy's hero says "Also for macOS and Linux", which omits Windows, and download.html offers Windows. Change: detect the platform in plain JS (no third-party), make that platform the primary button, show the other two beside it, and fix the line to name all three. Widen the hero clip toward 1,000px on desktop so the real app stays the picture.

2. **State "no cookies, no third-party scripts" in the hero trust line.** Both competitors open with a cookie control over the first fold (Cline's bottom bar, Kilo's Transcend sheet). Draggy has none, and that is a visible advantage. Add it to the line under the subhead and to the footer. Verify it first: the only script is Vercel's own analytics.

3. **Add a /open-source/ page modelled on Kilo's /open.** Kilo separates what is MIT-licensed, what is source-available, and what is hosted. Cline has no open-source page (/open-source is a 404) and relies on "Apache 2.0 open source" in a strip. Draggy should state exactly what is Apache 2.0 (the app and its build), what the third-party models are and their licences, what leaves the machine (nothing, unless a cloud provider is added), and how to build from source. Link it from the hero trust line and the footer. Text only, and no numbers unless measured.

4. **Add a short, plain "bring your own model" block.** Kilo says "500+ models, zero markup ... or your own keys"; Cline says "Bring your own key, your own endpoint, or your own weights". Draggy only names ChatGPT, Claude and Gemini. Add a text list of the provider types the app actually supports (check against the app's provider code before publishing). No logo wall.

5. **Replace the five stacked feature blocks with one tabbed clip switcher.** Cline's "See Cline at work" and Kilo's agent tabs show one real screenshot with three or five tabs. Draggy's five blocks take about 1,700px on desktop and about 2,300px on mobile. Use a segmented control over Research / Code / Approval / Voice / Browser with one large clip. Keep muted, looping, poster-only under reduced motion, and the existing footer pause control.

6. **Put version, date, file size and checksum next to each download button.** Cline shows "v0.0.45 · macOS, Windows & Linux" and "Release notes", and Kilo shows the install command. Draggy shows only "166 MB · Build 1" on the home page. Add the version, a release-notes link and the SHA-512 link beside the primary buttons. The checksum commands already exist on download.html.

7. **Add one copyable terminal install line for Linux.** Kilo's CLI card has a copy button with a one-line curl installer and package-manager variants. Draggy's Linux AppImage needs `chmod +x` and a run step, which is explained only on download.html. Show the two exact commands under the Linux button, with a copy control. No tabs for their own sake.

8. **Promote the hardware table to a visible link under the hero CTA.** "Will it run on mine?" is Draggy's most honest content, and competitors avoid hardware questions entirely. Link it from the hero, with a short line such as "Runs on 8 GB laptops and up" only if that is measured on the current release.

9. **Use one accent colour, from the app, for three things only.** The home page currently uses only #111, grey, white and light grey. Cline's purple and Kilo's yellow give both sites instant recognition. Pick the app's accent and apply it to the primary download button's focus state, the active clip tab, and inline links. Keep the page itself black on white.

10. **Add a factual trust strip under the hero that has verifiable parts.** Cline's strip ("Apache 2.0 open source") and Kilo's badges show the pattern; Kilo's "#1" and "5M+" stats are the anti-pattern. Draggy can say: "Apache 2.0 · Source on GitHub · Checksums published · Release 1". Show the GitHub star count once it passes `starsMin` (25), not before.

## Things Draggy should not copy

- ASCII art or a robot mascot in the hero (Cline). Breaks the rules outright.
- Rotating hero copy ("Ship securely w/ Grok" / "Kimi in VS Code"). Unstable and hard to quote.
- Cookie sheets over the hero, and a newsletter form in the footer (Cline, Kilo). Draggy has no forms.
- A 60-plus link footer with "vs Cursor" and "vs Cline" pages (Kilo).
- Gradients, glowing borders, pill badges, pill buttons and a dark-only theme (Kilo). All conflict with Draggy's rules.
- Logo walls and unverifiable stats ("#1 Open Source Product of the Month", "10T+ tokens"). Draggy has no claim to back a logo wall, and the rule is numbers only when measured.
- Affiliate redirects on CTAs and session-recording analytics (Kilo). Both conflict with Draggy's privacy rules.
- A third-party tag stack (Cline: GTM, Google Ads, Meta, HubSpot, Reddit, LinkedIn, X). Roughly 0.8 MB of JS, and it breaks the no-third-party-requests rule.

## Rule conflicts found and proposed equivalents

- Cline's ASCII robot hero: ASCII art and a mascot. Equivalent: the real app clip, large.
- Kilo's yellow glowing stat cards and gradient Auto Model card: gradients and glow. Equivalent: a plain "Measured" text block (download size, checksum, licence) with a 1px border and no shadow.
- Kilo's pill "Why Kilo?" badge and floating CTA pill: pill buttons. Equivalent: a rectangular label at 8px radius or less.
- Kilo's dark-only theme: conflicts with "white page, black type". Equivalent: keep the white page, and keep the working dark mode.
- Kilo's product card grid of seven surfaces: fine as a pattern, but Draggy should list platforms as plain text rather than icons.

## Where Draggy is already ahead

- Fewest requests (16), no third-party requests, about 4.3 KB gzipped JS, zero layout shift.
- No cookies, no consent UI, no forms, no affiliate redirects, no session recording.
- Honest hardware table, unsigned-app guidance and SHA-512 instructions.
- Four languages, working dark mode, reduced-motion rule, clips that do not autoplay and a footer pause control.
- Mobile layout with 16px gutters and no horizontal scroll.
