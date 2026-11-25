# Hermes Agent site teardown, for draggy.org

Date: 2026-10-12. Target: https://hermes-agent.nousresearch.com (home, /docs, /docs/getting-started/installation). Comparison: Draggy build at http://localhost:4173 (home, /download.html, /wiki/).

## Summary

Hermes looks deliberate because of five copyable moves:

1. One saturated color field (#0000f2) with off-white type, and a 108px light condensed headline.
2. An install box in the hero: OS-detected tabs, one command, a copy button that confirms "Copied install command".
3. One real app video at 1,080px directly under the hero, with a caption.
4. A fixed feature card system: "#1 CONNECT" eyebrow, 48px title, two-line body, square tile, repeated six times.
5. Large section headings (80px) with 60 to 180px of space above each section, so sections read as chapters.

Most of the rest breaks Draggy's rules: scroll-linked blur, a glowing viewport frame, parallax, duotone engraving art in place of product, a 22.2 MB hero video, and nine third-party tracker requests.

Draggy already beats Hermes on weight (about 553 KB against 7.2 MB), JavaScript (12 KB against 1.5 MB decoded), trackers (none against nine), dark mode (Hermes home has none), and seeing the product above the fold (Hermes shows an engraving there). The gap is scale and hierarchy: Draggy's app clip is 658px wide, its H1 is 56px at weight 600, its H2s are 40px, and its install CTA only detects the OS without a manual switch. The top 10 takeaways are in section 7.

## 1. Section breakdown (home, 1440px)

Measured positions are from the styled page at 1440px wide.

| # | Section (y, height) | Purpose | Copy (verbatim from DOM) | CTA (label, target) | How the product is shown |
|---|---|---|---|---|---|
| 0 | Header (y 0 to 145, not sticky) | Brand and nav | NOUS, HERMES, DOCS; HERMES AGENT wordmark; COMMUNITY, PORTAL, INSTALL with a chevron | INSTALL dropdown: Via terminal, For Mac OS, For Windows, For Linux, In the cloud | None. Discord, GitHub and X icons sit under the logo. |
| 1 | Hero (y 145 to 825) | Headline and first action | H1 "The Agent That Grows With You" (3 lines, 108px). No subhead. | "INSTALL VIA TERMINAL" (primary, white, anchors to #install); "DEPLOY TO THE CLOUD" (secondary, translucent, to portal /cloud) | A duotone engraving, 631x793, with scroll parallax. No app is visible in the first screen. |
| 1b | Install box (y 621 to 742) | Copy-paste install | Label "INSTALL VIA TERMINAL"; tabs ": macOS :", ": Linux :", ": Windows :" | Copy icon on the command | Text only. |
| 2 | App preview (y 905 to 1537) | Product proof | Caption "HERMES DESKTOP, BETA PREVIEW" | None | Real desktop recording, 1,080x632, muted loop, poster frame, no autoplay. This is the largest product image on the page. |
| 3 | Hermes Desktop App (#downloads, y 825 to 2172; H2 at y 1679) | Platform downloads | H2 "Hermes Desktop App"; subhead "Available across all computers."; cards MACOS 12+ "Mac OS", WINDOWS 10/11 "Windows", ANY DISTRO "Linux" | "DOWNLOAD DESKTOP APP" (Hermes-Setup.dmg, Hermes-Setup.exe, direct links) x2; "INSTALL VIA TERMINAL" (Linux card, to #install) | Three engraving-textured cards. No screenshots. |
| 4 | Features (#features, y 2172 to 3683; H2 at y 2352) | Capabilities | H2 "Features". Six items: #1 CONNECT "Lives Everywhere" (Telegram, Discord, Slack, WhatsApp, Signal, Email, CLI and a growing list of platforms. One agent, one memory, every surface.); #2 REMEMBER "Persistent Memory"; #3 SCHEDULE "Focused Automation"; #4 DELEGATE "Tasks Multiplied"; #5 SEARCH "Browse the Web"; #6 EXPERIMENT "Isolated Sandboxing" | None | Six duotone engravings, about 333px square. No product. The background switches to light grey (#f2f2f2) here. |
| 5 | FAQs (#faqs, y 3683 to 4380) | Objections | H2 "FAQs" with "VIEW DOCS" link. Questions: "How does pricing work?", "How do I get started?", "How do I chat with my agent?", "Does my agent keep its data between sessions?", "What happens when I stop my agent?" | VIEW DOCS (to /docs) | None. Questions are 32px display type; answers 16px. |
| 6 | Nous Portal (#portal, y 4380 to 5451) | Upsell for hosted tiers | H2 "Nous Portal"; "All paid tiers include monthly credits for use in Hermes Agent, access to 200+ cutting-edge models and built-in tool use". Tiers: FREE $0, PLUS $20 (10% bonus), SUPER $100 (MOST POPULAR), ULTRA $200 | "CREATE AN ACCOUNT", "SIGN IN"; tier CTAs "FREE HERMES", "RELEASE HERMES", "LIBERATE HERMES", "UNLEASH HERMES" (all to portal manage-subscription) | Engraving band, then a four-column price table. No product. |
| 7 | Footer (reveal wrapper, y 4901 to 7226) | Sign-off | Tagline "THE INTERNET'S OWN AI"; "(c) 2026, Nous Research, Inc."; TERMS, PRIVACY; "MIT LICENSE, 2026". Link columns: Nous, Hermes, Community, Portal, Legal. | Icon links (Discord, Nous, Hermes), GO TO DISCORD, GITHUB, X, YOUTUBE | Large faint "HERMES" wordmark behind the content. The footer is a sticky reveal under the last section and un-blurs as it enters. |

Social proof: none on the home page. No star count, no testimonials, no logos, no user numbers. Trust cues are the MIT license line, Nous Research attribution, and the "Open source" wording in the FAQ.

Changelog: no link on the home page. /changelog and /releases return 404. The docs sidebar has a "Download" item that opens externally.

Mobile (390px): the header collapses to logo, "INSTALL HERMES" button and a hamburger. The hamburger menu holds NOUS, HERMES, DOCS, COMMUNITY, PORTAL, and an INSTALL submenu with the same five entries. The H1 drops to 66px. Both CTAs stack at full width. The install command is cut off at the edge with no wrap. "Hermes Desktop App" at 80px wraps to three lines. The pricing grid turns two-up, and on the PLUS column the "MOST POPULAR" tag overlaps "10% BONUS". The page is 9,879px tall against 7,226px on desktop. There is no horizontal scroll (scrollWidth 380 at viewport 390).

## 2. Install and download flow

| Path | Steps | Clicks | Notes |
|---|---|---|---|
| Desktop app, macOS | Header INSTALL, then "For Mac OS" (scrolls to #downloads), then "DOWNLOAD DESKTOP APP" (direct .dmg link) | 3 to start the download, then open the .dmg | The download cards start about 1,800px down, so the hero has no download button. |
| Desktop app, Windows | Same route, then .exe | 3 | Direct link, no interstitial page. |
| Terminal | Hero "INSTALL VIA TERMINAL" (anchor to #install, tab auto-selected), then the copy icon, then paste and Enter | 2, plus paste | Copy confirms with aria-label "Copied install command". Clipboard write was verified. |
| Cloud | "DEPLOY TO THE CLOUD" to portal | 1 | Leaves the site. |

Commands in the install box:
- macOS and Linux: `curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash`
- Windows: `irm https://hermes-agent.nousresearch.com/install.ps1 | iex`

OS detection: yes, but only for the terminal tabs. A Mac user agent selects the macOS tab, a Windows user agent selects Windows, and the default in a Linux browser is Linux. The desktop cards and the hero CTA do not use detection; all three cards always show.

Docs: /docs/getting-started/installation repeats both commands and says "download the Hermes Desktop installer from our website and run it" for Windows and macOS.

Draggy for comparison: the hero button is detected by OS and links straight to the release file (Windows .exe, macOS arm64 .dmg, Linux AppImage), which is 1 click. The header Download goes to /download.html. That page shows each OS with file name, size, minimum OS or glibc, an unsigned-app warning, and checksums, which is more informative than Hermes' download cards. The hero's "Also for macOS and Linux" line is static HTML (see section 8).

## 3. Design system values

### Color

| Token or role | Value | Use |
|---|---|---|
| --hermes-color-blue | #0000f2 (body computed rgb 0,0,242) | Page field for the hero, downloads and footer band |
| --hermes-color-white | #f2f2f2 | Text on blue; the light section band (features, FAQ, portal, footer) |
| Text on light band | #000091 (computed rgb 0,0,145) | H2s and body on #f2f2f2 |
| Primary CTA fill | rgba(255,255,255,.98) with text #0000f2 | "INSTALL VIA TERMINAL" |
| Secondary CTA fill | rgba(242,242,242,.2) | "DEPLOY TO THE CLOUD" |
| Tab fill | rgba(255,255,255,.1) | Install tabs |
| Hue tokens | cyan #00f2f2, magenta #f200f2, pink #f20079, green #00f279, yellow #f2f200, orange #f27900, indigo #7900f2, neon #79f200, red #f20000, neutral #616191 | Used in the animated viewport-frame arc and the art tints (pink and cyan lines are visible in the engravings) |
| Contrast | #f2f2f2 on #0000f2 is 8.2:1; #000091 on #f2f2f2 is 13.3:1 | Both pass AA at body size |

Dark mode: none on the home page. The light and dark desktop captures differ in 1.2% of pixels, which is animation timing, and the mobile captures are identical. The docs have a theme toggle, and the portal uses system theme.

Draggy for comparison: #ffffff page, #111111 text (18.9:1), #5e5e5e secondary text (6.5:1), #0e0e0e dark page, dark mode via prefers-color-scheme. Accent variable --accent is #b45309.

### Type

| Role | Family | Size, line height, weight, tracking | Where |
|---|---|---|---|
| Hero H1 | Rules Gothic Condensed | 108px, 108px (1.0), requested 200, -0.02em (-2.16px). Only the 300 face is loaded, so the browser uses Light. At 390px the H1 is 66.3px. | Home hero |
| Section H2 | Rules Gothic Condensed | 80px, 80px (1.0), 400, -0.02em at every width | Features, FAQs, Nous Portal, Hermes Desktop App |
| Feature H3 | Rules Gothic Compressed | 48px, 52.8px (1.1), 500. At 390px it is 41px. | Feature cards |
| FAQ question | Rules Gothic Compressed | 32px, 44.8px, 400 (inside a 14.2px button) | FAQ rows |
| Body | Rules Variable | 16px, 24 to 25.6px, 400 | Subheads, FAQ answers |
| Base | Aeonik Fono Pro TRIAL | 14.2px, 21.3px | Page default |
| Eyebrow | Aeonik Fono Pro TRIAL | 10px, 15px, uppercase | "#1 CONNECT" |
| Install label, command, tabs | Aeonik Fono Pro TRIAL | 11px, 16.5px, uppercase. The command is not monospace. | Install box |
| CTA | Rules Condensed | 15px, 21px, 500, +0.3px, uppercase | All buttons, 36px tall |
| Nav | Rules Condensed | 14px, 21px, 500, +1.4px (0.1em), uppercase, opacity .8 | Header |

Type tokens in the CSS: --hpv2-type-hero 108px, --hpv2-type-heading 80px, --hpv2-type-body 16px/20px, --hpv2-type-label 14px/18px, --hpv2-type-label-sm 12px/16px, --hpv2-type-legend 9px.

Draggy for comparison: Geologica Variable throughout. H1 56px, 64px line height, weight 600, -0.02em. H2 40px, 48px, 600. Body 17px, 28px. Subhead 20px, 30px. Buttons 16px, 500, 44px tall.

### Spacing and grid

- Content column: 1,080px at 1440 (x 175 to 1255). Downloads row: 1,240px.
- Gutters: 175px each side at 1440, 24px at 390.
- Feature grid: three columns of about 333px with about 40px gutters.
- Section top padding varies: 60px (FAQ), 118px (Portal), about 180px (Features). The hero flows straight into the desktop block with no gap.
- Spacing base: --spacing .25rem (4px).
- Fluid units: --u .58px for some type; --vsq calc(.5vw + .5vh) for the viewport frame.

Draggy for comparison: 1,120px container (x 160 to 1280 at 1440).

### Radius, borders, iconography

- Radius: CTAs 3px, install tabs 4px on the left pair, cards and video 0. No pill buttons.
- Draggy: 8px on buttons and FAQ rows, within the 12px rule.
- Icons: 15 to 24px SVGs. Each H2 has a small pixel-style glyph beside it (desktop, features cluster, document for FAQs, globe for Nous Portal). Platform logos (Apple, Windows, Linux) sit on the buttons. The Linux penguin is used as the terminal icon. Social icons, a copy icon and check marks appear in the pricing list.
- The install tab labels and "MOST POPULAR" use colon and slash ornaments (": macOS :", "//MOST POPULAR"). Draggy's rules ban ASCII-style ornament.

### Motion

| Effect | Implementation | Default | Reduced motion |
|---|---|---|---|
| Hero parallax | translate3d tied to scroll (--py-hero) | On | Off (transform none) |
| Hero fade and blur | Opacity 1 to 0.3 and blur 0 to 10px, scroll-linked | Defined in CSS. Not present on the home DOM in our check, so do not assume it is active. | Off |
| Footer soften | blur(10px x (1 - opacity)), resolves on entry | On. The footer is blurred at rest and in static captures. | Off |
| Image parallax | scale(1.22) and translate on art | On | Off |
| Feature panel | translate3d and clip-path inset | On | Off |
| Viewport frame | Fixed 5px blue border (desktop only) with four glow spans. Bloom is a 42s opacity loop (.3 to .48). An arc gradient moves over 14s, alternating. | On | Animation none, opacity 0 |
| Grain | Eight noise overlays, mix-blend plus-lighter | On | Unchanged |
| Button transitions | 0.15s | On | Unchanged |
| Smooth scroll | html class "lenis" (Lenis) | On | Unchanged |
| Video | Plays when scrolled into view (paused flips to false). Muted, looped, no controls. | Plays | Stays paused (verified) |

Playback is unverified: Playwright's bundled Chromium reports readyState 0 and NETWORK_NO_SOURCE for the MP4, so frames could not be seen in this environment.

### Mobile against desktop

- Header: desktop shows a centered logo with nav on both sides, and an INSTALL dropdown. Mobile shows the logo, an INSTALL HERMES button and a hamburger.
- Hero: desktop is two columns with art on the right. Mobile is one column with art below the install box.
- Downloads: desktop is three cards in a row. Mobile is three stacked cards.
- Features: desktop is 3x2. Mobile is one column.
- Pricing: desktop is four columns. Mobile is two columns, with the overlap noted in section 1.
- Footer: desktop shows link columns over a faint wordmark. Mobile overlaps the watermark with the copyright line.

## 4. Performance (sandbox measurements)

Method: Playwright Chromium, fresh context per run, two runs at 1440 and one at 390 for Hermes, two runs at 1440 for Draggy. Timings are noisy in this sandbox (Hermes load ranged from 1.8s to 13.9s), so compare bytes, request counts and element identity, not milliseconds. Draggy is served uncompressed by a local Python server, so its transfer sizes are an upper bound.

| Metric | Hermes home, 1440 | Hermes home, 390 | Draggy home, 1440 (local) |
|---|---|---|---|
| Requests | 56 to 60, of which 9 third-party | 57 | 9, none third-party |
| Transfer | about 7.2 MB | about 5.3 MB | about 553 KB |
| Images | 5.8 MB, 24 files | 3.8 MB, 21 files | 92 KB, 3 files |
| JavaScript | 16 first-party files, 1.55 MB decoded; all scripts 2.1 MB decoded | same | 1 file, 12 KB decoded |
| CSS | 5 files, 49 KB transfer, 228 KB decoded | same | 2 files, 16 KB |
| Fonts | 6 to 10 files, about 640 KB | same | 1 file, 25 KB |
| LCP element | hero.webp, 243 KB file, fetchpriority high | hero.webp | Hero clip poster (video element) |
| CLS | 0.054 in one run, 0.0002 in another | 0.0004 | 0 |
| Heaviest asset | hermes-desktop.mp4, 22.2 MB (preload metadata) | same | hero-light.webm, 356 KB |
| Page height | 7,226px | 9,879px | 4,697px (mobile 6,030px) |

Third-party requests on Hermes: Google Tag and Google Ads (gtag, googleadservices, google.com/rmkt, google user-list), DoubleClick, and LinkedIn Insight (snap.licdn.com and px.ads.linkedin.com). Vercel Insights runs from the site's own path. Draggy's budget (no third-party requests except Vercel's) is met.

Budget note: Hermes' first-party JS alone (1.55 MB decoded) is well over Draggy's 25 KB gzipped budget.

## 5. What Hermes does badly

1. The first screen contains no product. The hero is an engraving and an install box, and the app first appears around y 905.
2. The weight is extreme for a landing page: 7.2 MB on first load, a 22.2 MB hero MP4, 1.55 MB of first-party JavaScript, a smooth-scroll library, and nine third-party trackers.
3. Blur is used as decoration: the footer is blurred until it scrolls into view, and the static captures show it blurred. Reduced-motion users get the sharp version; default users get the blur.
4. Mobile defects: the PLUS pricing tag overlaps "10% BONUS"; the install command is clipped at 390px with no wrap; the 80px H2s wrap to three lines; the footer watermark overlaps the copyright.
5. Small type: eyebrows at 10px, install label, tabs and command at 11px. The command is set in the display sans, not monospace, which makes it harder to read and copy.
6. One theme only on the home page. Blue is the only background, so there is no dark mode and no light page.
7. Trust gaps: no stars, testimonials or release link, and the claims ("200+ cutting-edge models", and in the docs "The only agent with a built-in learning loop") are unverified in our review.
8. Licensing: the production home uses "Aeonik Fono Pro TRIAL", a trial-licensed font. Do not copy the font files.
9. The header is not sticky (position relative), so nav and Install scroll away.
10. The docs are stock Docusaurus 3.10.2 (Inter, default styling), which is a different visual system from the marketing site.
11. The Portal upsell takes about one screen of the home page. It is off-message for a free app.

## 6. Hermes patterns against Draggy's rules

| Hermes pattern | Draggy rule it breaks | Rule-compliant equivalent |
|---|---|---|
| Full-bleed #0000f2 field, off-white type | "White page and black type" | Keep the page white and type #111. Put the accent on the primary CTA and the install box only. |
| Duotone engravings, pixel glyphs, textured cards | "No generated illustrations or stock imagery"; "the real app shown large" | Use real clip stills in the same frame size for each feature. |
| Scroll-linked blur (footer, hero fade) | "Never add blur" | Remove. Use no blur at all. |
| Viewport frame glow, gradient arcs, bloom loop | "Never gradients, blur, glow" | Remove. |
| Parallax and scale(1.22) on images | "Motion only from the clips" | Remove. Motion comes only from clips, with the footer pause control. |
| Grain overlay and vignette | Decorative effects | Remove. |
| Faint "HERMES" watermark at 2 to 15% opacity, exclusion blend | Decorative effect | Solid wordmark in #111 with no opacity or blend. |
| ": macOS :", "//MOST POPULAR" ornaments | "ASCII art" | Plain labels. |
| 22.2 MB hero MP4, 1.55 MB JS, nine trackers | Home under 600 KB first load; JS under 25 KB gzipped; no third-party requests | Keep clips at 1.5 MB or less. Keep the current stack. |
| Upsell pricing with four tiers | Draggy is free; no upsell | Not applicable. |
| CTA names "Free Hermes", "Liberate Hermes" | Plain, calm voice; sentence case | Keep "Download for Linux" style labels. |
| Unverified superlatives | "Check every factual claim"; no unmeasured numbers | Keep Draggy's measured facts (file size, OS minimums, build). |
| Aeonik Fono Pro TRIAL | License risk | Keep Geologica. |

## 7. Top 10 takeaways for Draggy, ranked by impact

1. Widen the hero clip to about 1,000px and place it directly under the H1 and CTAs, with a one-line caption. Hermes' only large product image is 1,080px and sits right after its hero; Draggy's hero clip is 658px, so the app reads as a thumbnail. The 1.5 MB clip cap still applies.
2. Add an OS switch (Linux, macOS, Windows) beside the hero button that swaps the label, file name and size, with detection as the default. Hermes' tabs auto-select by user agent and show one command with a copy button; Draggy's button only detects, and the static "Also for macOS and Linux" line is wrong for Linux and macOS visitors.
3. Set the H1 at display size: about 96 to 108px on desktop (clamp), weight 300 to 500, line height 1.0, letter spacing -0.02em. Hermes' 108px light condensed headline is the strongest hierarchy move on the page; Draggy's 56px at weight 600 reads as a standard landing page. Keep Geologica.
4. Raise section H2s from 40px to about 64px, add 120 to 180px above each section, and remove most hairlines. Hermes' 80px H2s and long gaps make sections read as chapters without any extra color.
5. Re-frame the clips so UI text stays legible at display size. Crop the encoded clip to the working pane and keep the 1280x800 capture. At 658px, the full window is about half scale and the sidebar and composer text is hard to read.
6. Give the six capabilities a fixed grid: a numbered eyebrow ("#1 RESEARCH"), a title, a two-line body and one clip still in an identical frame. Hermes' repeated card scans in seconds. Draggy's alternating rows are good for storytelling but vary in alignment and clip size.
7. Caption each clip with what the viewer is seeing and the speed-up. Hermes captions its one app video ("HERMES DESKTOP, BETA PREVIEW"). I did not see a visible caption under any Draggy clip at 1440, and AGENTS requires the sped-up waits to be labeled.
8. Put a copy button on any command shown on /download or in the wiki, in a monospace block that wraps on phones. Hermes' copy box is its only working affordance on the page, but its command is 11px sans and gets clipped at 390px.
9. Reduce corner radius from 8px to 4px on buttons and cards, and drop the card borders. Hermes' 3px corners give a sharper, technical tone within the same 12px rule. Low cost.
10. End the page with a plain, large "Draggy" wordmark in #111, with no opacity tricks and no blur. Hermes ends on a giant wordmark that anchors the page; Draggy's footer is clean but generic.

Not on the list, on purpose: the blue field, engravings, blur, glow, parallax, watermark, trackers, the 22 MB video, and the upsell. Each one is either against the rules or costs weight Draggy does not have to spend.

## 8. Draggy-side issues found during the comparison

- The hero reads "Also for macOS and Linux" as static text in the HTML, while the primary button switches by OS (data-os-match). On Linux and macOS the line names the visitor's own OS and leaves out Windows. The French copy has the same problem ("Aussi pour macOS et Linux"). Fix: list all three, or make the line follow detection.
- No visible caption appears under any clip in the 1440 render. Check the clip markup; if captions exist they are hidden.
- /download/ returns 404 on the Python preview server because the preview does not map clean URLs. The site links to download.html, which works. This is a preview limitation, not verified on Vercel.
- Hero clip width is 658px. Feature clips are about 500px. The hero webm is 356 KB and its poster is 38 KB, both within budget.

## 9. Method and caveats

- Playwright 1.56.1 with the bundled Chromium. Computed styles were read from styled pages only; a guard checks that the H1 computes to 108px (Hermes) before any measurement is taken.
- One load of the Hermes home page came back unstyled (the main 196 KB stylesheet did not apply), giving a page 51k to 62k px tall. I did not reproduce it in five fresh loads, and all later runs were styled. I discarded the unstyled runs.
- The WebFetch summary was paraphrased, so every quote here comes from DOM text extraction.
- Blur states depend on scroll position. Full-page captures show the footer blurred; the viewport capture at the footer is the reference.
- The Hermes desktop video could not be decoded in this Chromium (H.264 is not available), so no frames of it were seen. JS-driven play-on-view and the reduced-motion pause were verified.
- Engraving art provenance was not verified.
- Earlier files in shots/hermes/ named home-desktop-* and home-mobile-* (18:55) predate this pass and may come from an unstyled load. Use home-desk-* and home-mob-*.

## 10. Files

Screenshots (scratchpad/shots/hermes/):
- Hermes full page, 1440: home-desk-light.png, home-desk-dark.png. Sliced for reading: slice-desk-light-00.png to slice-desk-light-07.png.
- Hermes full page, 390: home-mob-light.png (dark is identical). Sheets: sheet-mob-light-0.png to sheet-mob-light-2.png.
- Hermes docs: docs-home-desk-viewport.png, docs-install-desk-viewport.png.
- Hermes nav and menu: nav-install-dropdown-desk.png, mob-menu-open.png.
- Draggy full page, 1440 and 390: draggy-home-desk-light.png, draggy-home-desk-dark.png, draggy-home-mob-light.png. Slices slice-draggy-desk-00.png to slice-draggy-desk-04.png; sheets sheet-draggy-mob-0.png and sheet-draggy-mob-1.png.
- Draggy download and wiki: draggy-download-viewport.png, draggy-wiki-viewport.png.

Scripts (scratchpad/scripts/hermes/): probe.cjs, sections.cjs, shots.cjs, footer.cjs, height.cjs, height2.cjs, frame.cjs, variant.cjs, cssprobe.cjs, styles.cjs, scale.cjs, interact.cjs, docs.cjs, perf.cjs, video.cjs, videoplay.cjs, draggystyles.cjs, dl.cjs, nav.cjs, textprobe.cjs, dstick.cjs.

Raw source (scratchpad/hermes-raw/): css/ (five Hermes stylesheets, including the main 196 KB one), docs-home.html, install-doc.html.
