# draggy.org content audit

Date: 2026-10-12. Repo: `/home/user/draggy-website` at `d5f339b`, working tree clean. Read-only: nothing was edited, built, committed or pushed. The existing `public/` output (built 18:52) was read, not rebuilt.

## Coverage and limits

- Read in full: `tools/locales/en.json`, `tools/pages/*.html`, `tools/wiki/en.html`, `tools/policy/en.html`, `release.json`, `site.config.json`, `vercel.json`, `middleware.js`, `.github/workflows/release-data.yml`.
- Read in the relevant parts: `tools/errors/en.html` (opening sections, the colibri group and every marker; the rest was scanned for numbers and rule breaches), `tools/build.mjs` (meta, JSON-LD, `llms.txt`, clip and string code), `assets/js/site.js` (cookie and strings code), and the copy tests in `tools/site.test.mjs`.
- Spot-checked: `tools/wiki/fr.html` and `es.html` (home, installation, models, composer, permission tables, privacy) and every fr/es/zh string on the home, hero, FAQ, download, first-run and hardware keys. `tools/wiki/zh.html` was read as text through the Settings page; Troubleshooting and Development in Chinese were not read. The four privacy policies were compared by key terms, and the Chinese policy was read in full.
- Automated: `npm run i18n` passes (222 keys in each of the four languages). Scratch scripts are in `scratchpad/scripts/content/`: `locale-compare.mjs`, `numbers.py`, `unused-keys2.mjs`, `overflow.mjs`.
- Could not check: the app repo (not attached in this session, so every app-behaviour claim is in section 7 as unverified). The `/unslop` skill named in AGENTS.md is not available in this session, so the same checks were done by hand. Competitor sites were not visited, so the positioning in sections 3 and 4 needs a current check.
- Browser check: Playwright at 320px on nine pages of `localhost:4173` (home, download, four English wiki pages, three translated wiki pages). No unwrapped table was wider than the viewport, so the length of translated labels is not a current layout problem.

## Summary: the biggest issues

1. **Spanish is corrupted.** `tools/locales/es.json` has 12 keys with double-encoded UTF-8, such as "c├│digo" and "est├í". Six built Spanish pages show it (`public/es/index.html`, `download.html`, `wiki/index.html`, `wiki/models`, `wiki/tools`, `wiki/troubleshooting`). No test catches it. (6.2)
2. **Clip captions never render.** `tools/build.mjs:1068` captures the caption argument and drops it, so none of the six homepage clips shows its speed-up label. AGENTS.md requires that label. The caption text also contains `{version}`, `{model}` and `{speed}`, which nothing fills in. (2.13)
3. **Privacy copy overclaims and contradicts itself.** "Nothing about you is collected" (`privacyPolicy.description`), "runs with no network connection at all" (policy), "none of the requests above are made" (wiki privacy) and "Nothing leaves your computer unless..." (wiki home). Update checks are on by default (wiki `en.html:61`), and ad-blocker list downloads are not covered by the steps those lines give. (1.6, 2.19, 2.21)
4. **The cookie rule is out of date.** AGENTS.md says "The site has no cookies". `assets/js/site.js:121` and `middleware.js:54` set and read `draggy-lang`, and the policy discloses it. Either AGENTS.md or the code needs to change. (7, "Other")
5. **A default-mode claim is false.** `home.f3Text`: "Before it runs a command or writes a file, it asks." In Accept edits, the default, edits do not ask. Only commands and deletes do (wiki permission table). (2.2)
6. **`providers.json` is missing.** The policy (all four languages) and the wiki say the app reads `draggy.org/providers.json`. The file is in neither the repo nor `public/`. (7)
7. **The homepage fails the five-second test.** It has no subhead: `hero.lede` is written for that slot but only `llms.txt` uses it. The H1 does not say "app" or "AI assistant", and the `<title>` is just "Draggy". (3)
8. **The wiki contradicts itself on basics.** Ctrl+K means both "command palette" and "change model". The macOS quarantine fix uses two different commands. "60%" is both "spilling" and "too big". The Mac table has errors. (5, W1 to W7)
9. **An engine is never defined.** "colibri" appears 11 times in the error pages and never in the wiki, which names llama.cpp as the engine. (W9)
10. **Translation leaks.** `tools/pages/download.html:139` and `:146` hard-code "Apple silicon (arm64)" and "Intel (x64)", so the fr/es/zh download tables show English. zh uses 提供方 in the wiki and 服务商 in the locales, and 语音模式 and 语音对话 for the same feature. (6.3, 6.4)
11. **Dead strings ship to every language.** 11 keys (`table.*` and `js.yourSystem`) are serialized into every page and never read. The seven clip caption keys are dead too (see 2.13). `check-i18n` reports 11 keys as unused that are used (`errors.*`, `privacyPolicy.*`), so its output is misleading. (6.9, 6.1)

---

## 1. Rule compliance in English copy

Automated sweep of `en.json`, `tools/pages`, `tools/wiki/en.html`, `tools/policy/en.html`, `tools/errors/en.html`, `build.mjs` and `site.js`:

| Rule | Result |
|---|---|
| Em dashes | 0. Also enforced by `site.test.mjs` ("no em dashes"). |
| Exclamation marks in copy | 0 (only in HTML comments). |
| "offline" | 0. |
| Title case in headings | 1: wiki `en.html:134`, "Apple Silicon". Use "Apple silicon", as `download.appleSilicon` does. |
| Model-quality claims | 2 borderline (1.1). |
| Unmeasured numbers | Many. Every number is listed in section 7. Key ones are in 1.2 to 1.5. |

Findings:

- **1.1 Model capability, borderline.** wiki `en.html:944`: "The model may be too small to call tools reliably, and more tools switched on makes it harder." Same idea in `errors/en.html:78`: "A small model with many tools on may not call them reliably." Problem: a claim about model quality, which the rules ban. Rewrite (wiki): "If the model writes a tool call as plain text, switch off the tools you do not use and try again." Rewrite (errors): "If a tool call fails, turn off the tools you do not need, then send the message again."
- **1.2 Unmeasured disk figure.** `hw.disk` (en.json:174): "Plan for 10 GB of free disk for a typical model." Also wiki `en.html:29`. Problem: not measured on this release. Rewrite once measured: "A typical model downloads about [measured] GB. Keep that much free, plus room for the app." Until then, cut the number: "Keep room for a model download, which is several gigabytes."
- **1.3 Unmeasured model-by-size claims.** `hw.gpu.verdict` (en.json:173): "The model runs on the card, from Qwen 3.5 9B upward." The wiki tables (`en.html:110` to `131`, `:141` to `153`) make the same kind of claim for about a dozen model names. Problem: needs to match the app's catalogue on build 1. Rewrite: date-stamp the tables ("Models for build 1, [date]") and generate them from the app's catalogue.
- **1.4 Unmeasured timings.** wiki `en.html:61`: "checks twenty seconds after launch and every six hours". Also `:489` (ten minutes), `:624` (twenty seconds), `:784` (1500 ms) and `:765` (0.9x to 1.25x). Problem: each needs a source in the app code, or it should be cut. Rewrite: keep the ones the app's settings expose and remove the rest.
- **1.5 Vague size.** wiki `en.html:55`: "The download is several gigabytes and starts on its own." Also `:921`. Problem: vague, and the AGENTS rule asks for measured numbers. Rewrite: "The first model downloads automatically. It is [measured] GB for the default choice."
- **1.6 "No telemetry" on the site's own metadata.** `index.description` (en.json:18), `og.meta` (:16), `tools/og-card.html:109`, JSON-LD (from `index.description`), `llms.txt`, and wiki `en.html:853`. Problem: the site runs Vercel Web Analytics, which records the page, referrer, country, browser and device (policy). The phrase reads as a claim about the site. Rewrite (site-level meta): "Draggy is a free desktop AI assistant that runs open models on your own computer. No account. Add ChatGPT, Claude or Gemini if you want." Keep "no telemetry" only on app pages, and only after the app is verified.
- **1.7 Stars label promises a count that is hidden.** `nav.stars` (en.json:128): "Draggy on GitHub, with its star count". Problem: `release.json` has `stars: 1`, below `starsMin` (25), so no count is shown. Rewrite: "Draggy on GitHub".
- **1.8 Two keys, one string.** `hero.heading` (en.json:21) and `home.heading` (:193) are identical. Problem: translators translate it twice. Rewrite: keep one key.
- **1.9 Contraction mismatch.** `404.message`: "This page isn't here." (en.json:222). `notFound.description`: "That page is not here." (:52). Rewrite: use "is not" in both, or "isn't" in both.
- **1.10 Title case.** Wiki `en.html:134`: "Apple Silicon</h2>". Rewrite: "Apple silicon".

## 2. AI-slop, fluff and overclaims

The copy has almost none of the usual vocabulary. Checked and absent: "seamless", "powerful", "unlock", "supercharge", "cutting-edge", "robust", "empower", "leverage", "not just X, it's Y", "whether you're", "in today's", filler openers. The problems are repetition, formula headings, and absolutes that the app does not back up.

- **2.1 Formula headings.** `home.f1Title` to `f5Title` (en.json:203, 206, 209, 212, 215): "The research." "The code." "The approval." "The voice." "The browser." Problem: five fragments that say nothing on their own, and the same shape three times in a row. Rewrite: "Research with sources." "Code edits you can undo." "Asks before commands." "Talk to it (beta)." "A browser with tracker blocking."
- **2.2 Overclaim in a feature block.** `home.f3Text` (en.json:210): "Before it runs a command or writes a file, it asks. You choose how often." Problem: false in the default mode. Accept edits lets edits through without asking, and Auto asks for nothing (wiki permissions table, `en.html:415` to `:418`). Rewrite: "Commands ask first unless you pick Auto. You choose how much else it asks about."
- **2.3 Slogan title.** `home.v1Title` (en.json:197): "Your files stay yours." Problem: a slogan, and it is absolute while a cloud provider sends files out. Rewrite: "Your files stay on your disk, by default."
- **2.4 Slogan title.** `home.v3Title` (en.json:201): "Open, all of it." Problem: vague. Rewrite: "Open source under Apache 2.0." Then check the repo is public.
- **2.5 Repetition on the homepage.** "No account" appears three times and "Apache 2.0" four times on `public/index.html`. The free block is `home.v2Title` (:199), `home.v2Text` (:200), `home.freeTitle` (:218) and `home.freeText` (:219), and the FAQ `faq.q1` and `faq.a1` say the same. Problem: one claim said five ways. Rewrite: keep `home.trust` as the first-screen line, keep one "free" block, and cut `home.freeTitle` and `home.freeText`.
- **2.6 Repetition on the download page.** "Nothing is code signed" appears in `download.unsigned` (en.json:150), `download.official` (:121), `firstRun.lede` (:46) and wiki `en.html:36`. "SHA-512" appears three times on the page. Rewrite: say the unsigned warning once, next to the buttons, and point to the steps.
- **2.7 Logic error in a trust statement.** `download.official` (en.json:121): "Nothing is code signed, so a copy from anywhere else could be tampered with and you could not tell." Problem: you can tell, by comparing the SHA-512 with the one published here. Rewrite: "Download only from this site or the GitHub releases page. Nothing is code signed, so compare the SHA-512 below with the file you downloaded."
- **2.8 Heading that promises a reveal.** wiki `en.html:180`: "The number that matters". Rewrite: "Reading the GPU figure".
- **2.9 Vague permissions summary.** `wiki.permissions.description` (en.json:77): "Four modes, from only proposing to working on its own." Rewrite: "Four modes, from Plan only to Auto."
- **2.10 Jargon in a summary.** `wiki.commands.description` (en.json:79): "What the model may run, in which shell, and what an allowance covers." Rewrite: "What the model can run, which shell it uses, and what Always allow remembers."
- **2.11 Pointer that hides the answer.** `faq.a3` (en.json:139): "Choosing a model has the numbers." Rewrite: "Choosing a model lists the models for each graphics card size."
- **2.12 Unclear caption.** `clip.code.caption` (en.json:180): "The time the model spends thinking is shown {speed}x faster." Problem: unclear, and it has placeholders nothing fills in. Rewrite: "Recorded on Draggy {version} with {model}. Waiting time sped up {speed}x." Then wire the substitution (see 2.13).
- **2.13 Caption is never shown.** Built pages have 0 of 6 captions (`public/index.html` and the three translations). `tools/build.mjs:1068` drops the third argument. Even if wired, `t()` does not fill `{version}`, `{model}` or `{speed}`. Fix: pass the caption to `clip()`, substitute the three values from `assets/clips/<name>.json` and `release.version`, and render the caption under the clip. Add a test for it. Until then, delete the seven `clip.*.caption` keys in all four languages.
- **2.14 Vague lede.** `errors.lede` (en.json:114): "Every error Draggy links to, with what it means and what to do next." Rewrite: "The error messages Draggy can show, what each one means, and what to do next."
- **2.15 Instruction is wordy.** `download.checkLede` (en.json:147): "Compute the SHA-512 checksum in a terminal and compare it with the one listed under Every file." Rewrite: "Run one command in a terminal, then compare its output with the SHA-512 under Every file."
- **2.16 Slogan in a summary.** wiki `en.html:50`: "Every release publishes a SHA-512, if you would rather check than trust." Rewrite: "Every release publishes a SHA-512 for each file, so you can check a download."
- **2.17 Absolute in the wiki.** wiki `en.html:157`: "Every Mac with Apple silicon, from the first one in 2020:". Problem: "every" is a claim the table cannot back (see W7). Rewrite: "Apple silicon Macs, from 2020 on:" and check the list.
- **2.18 Unverified security claim.** wiki `en.html:246`: "Draggy never sees your password." Problem: depends on each vendor's sign-in tool, which the wiki says Draggy downloads. Rewrite only once verified: "Your password goes to the company's sign-in page, not to Draggy."
- **2.19 Absolute about extensions.** wiki `en.html:681`: "...which makes them the only extension that sends anything off your computer." Problem: a local server such as GitHub or Slack also sends requests to its service. Rewrite: "Remote servers run elsewhere and are reached over HTTPS. A local server sends requests to the service it is built for, such as GitHub."
- **2.20 Overclaim about voice.** `faq.a2` (en.json:137): "Chat, Code, search in your documents and voice run on your machine." Problem: cloud voice sends reply text to a provider. Rewrite: "By default, chat, code, document search and voice run on your computer. Web search, updates and any provider you add use the internet."
- **2.21 Overclaim on the wiki home.** wiki `en.html:3`: "There is no account to make. Nothing leaves your computer unless you ask for something that needs the internet or add a cloud provider." Problem: update checks (on by default) go out without a request, and ad-blocker list downloads may too (verify when they run). The policy says "a few routine checks". Rewrite: "Conversations stay on your computer unless you add a cloud provider. Some routine requests still go out, such as update checks and ad-blocker lists. The privacy page lists each one."
- **2.22 Overclaim in the trust line.** `home.trust` (en.json:194): "No account. Your chats and files stay on your disk." Problem: true only without a cloud provider. Rewrite: "No account. Chats and files stay on your disk unless you add a cloud provider."
- **2.23 Gemini vs Google.** `faq.q4` (en.json:140) says "ChatGPT, Claude or Gemini"; `faq.a4` (:141) says "a ChatGPT, Claude or Google plan". `index.description` says Gemini. Rewrite: use "Google Gemini" in the answer, or "Gemini" throughout.

## 3. Value proposition

### 3.1 Five-second test

| Question | What the first screen says now | Verdict |
|---|---|---|
| What is it? | H1: "Web research and coding, with the model on your own computer." It does not say app, assistant or open source. The small line under the buttons says "Also for macOS and Linux · Free, Apache 2.0". | Partial |
| Who is it for? | Nothing. | Fail |
| Why not Ollama, LM Studio or a cloud tool? | "No account. Your chats and files stay on your disk." That is the only differentiator, and it is conditional. | Weak |
| What do I do next? | "Download for Windows", with the OS detected. | Pass |

Other first-screen problems:

- There is no subhead. `hero.lede` (en.json:22) is the right text for that slot, but `public/index.html` does not contain it. Only `llms.txt` uses it.
- The download buttons show "129 MB · Build 1". A stranger reads "Build 1" as early or beta, and sees no version. The version (3.0.1) appears only in JSON-LD.
- The `<title>` is "Draggy" (`index.title`, en.json:17), and so is `og:title`. Search results and link previews say nothing. Rewrite: "Draggy: a free AI assistant for your computer" (sentence case, under 60 characters).
- Nothing on the homepage says the builds are unsigned. The warning appears only on the download page, and it is the most likely point of failure for a new user.

### 3.2 Hero options

Keep the voice rules: plain, concrete, calm, sentence case, no em dashes, no exclamation marks, no "offline", no unmeasured numbers.

Headline (H1), three options:

- A. "A free AI assistant that runs on your own computer."
- B. "An AI assistant that works in your folders, on your own computer."
- C. "Chat, web research and coding, with the model on your computer."

Subhead, three options:

- A. "A free desktop app for Windows, macOS and Linux. It runs open models on your computer, reads the web and edits code in the folders you choose. It asks before it runs a command unless you turn on Auto."
- B. "No account and no subscription. Chats and files stay on your disk unless you add a cloud provider. Add ChatGPT, Claude or Gemini if you want."
- C. "Already run Ollama or LM Studio? Draggy finds those servers and can use them too. You do not need either one to start."

Primary button, three options (keep the OS detection):

- A. "Download for Windows" (current; keep)
- B. "Get Draggy, free"
- C. "Download Draggy (free)"

Secondary button: "Read the wiki first" (to `/wiki`), in place of "View source", which can move to the footer. Put one line under the buttons: "Builds are not code signed, so Windows and macOS warn you the first time you open them. The steps are on the download page."

### 3.3 What the copy can say today, with sources

- It is an app, not a model runner: chat, code, research, voice and a browser in one window (`home.f1` to `f5`).
- It uses servers you already run. Scan finds Ollama, LM Studio and others (wiki providers, around `en.html:213`).
- Commands ask unless you pick Auto. Every edit is a diff you can undo (wiki `en.html:377` and `:423`).
- No account, free, Apache 2.0. Cloud providers are optional and you pay them directly (`home.v2*`, `faq.a1`, `faq.a4`).

### 3.4 Claims to keep out of hero and meta

- Comparative claims about privacy ("more private than"), speed, answer quality, or model ranking. None is supported by the copy.
- "No telemetry" as a site-level claim while the site runs analytics.
- "Secure" or "safe" without a definition.
- "Offline", which is banned.

### 3.5 Competitor framing (verify before publishing)

These descriptions are general, not checked against current product pages. Ollama and LM Studio are usually described as local model runners (Ollama as a CLI and local API, LM Studio as a desktop app for models). Claude Code, Cline and Kilo Code are coding agents in a terminal or editor. Check each product's current docs and licence before writing any comparison, and especially before claiming "open source" against any of them. Hermes Agent, OpenClaw and Poolside were not checked.

## 4. Information architecture gaps

| Gap | Why it matters | Suggested change | Priority |
|---|---|---|---|
| Comparison page | Visitors from Ollama, LM Studio or a coding agent want the difference, and the site never states it. | "How Draggy compares": a feature table only, no quality claims, each row checked against current docs. | High |
| Requirements and GPU support | The home table and wiki give RAM and VRAM. They do not say which GPU vendors work (the wiki's development page names CUDA, Vulkan, ROCm on Linux and Metal), nor whether Windows on Arm or Linux arm64 are supported. `release.json` has no Windows-on-Arm or Linux arm64 builds. | A requirements page with a support matrix, and an explicit "not supported" line. | High |
| Supported models and licences | The site says "open models", but each model has its own licence. The wiki names about a dozen models by size and nothing about licences. | A model list page: family, licence, and a note that the model's licence applies. | High |
| FAQ depth | Five questions. Missing: "Can I use models I already have?", "What happens to my files?", "Does it ask before it changes things?", "Which languages?", "Why does my computer warn me?", "Does it update itself?", "Does it need the internet after setup?" | Add the questions above, each answered from the wiki. | Medium-high |
| Changelog | The only release history is a GitHub link. Visitors see "Build 1" with no version. | A changelog page keyed by version and build, linked from the download page. | High once releases exist |
| Security page | Permissions, refused paths, "run_code is not a sandbox", remote servers and log safety are all in the wiki, spread out. `security.txt` exists, but the footer does not link to it. | One security page with a link to `security.txt`, the threat model in plain words, and how to report. | Medium-high |
| Community and contributing | The wiki links CONTRIBUTING.md and SECURITY.md. The site does not link either. | A "Contribute" link in the footer and a clear issue path. | Medium |
| Glossary | Engine, provider, GGUF, quantization, context window, compaction, MCP, skill, embedding model, Talk, Auto are all used without definitions. | A glossary page in the wiki, linked from each term's first use. | Medium-high |
| Windows 10 end of support | The download page and wiki say Windows 10 1809 or newer. Microsoft's published end date for consumer Windows 10 Extended Security Updates is 13 October 2026 (verify). That is the day after this audit. | Decide the minimum-version copy now, and say what happens after the date. | High, time-sensitive |
| Uninstall | Uninstall instructions are under Privacy (wiki, "Uninstalling"), not Installation. | Link it from Installation. | Medium-low |
| Roadmap | Not needed. If added, mark as not promised. | Skip for now. | Low |
| Press kit | The repo has logos and OG images. There is no page for them. | A small "Brand" block with logo files and naming rules. | Low |
| Blog | Would duplicate the changelog's job. | Skip. | Low |
| Wiki search | 16 pages, no search. The sidebar works at this size. | Revisit when the wiki grows. | Low |
| Accessibility statement | AGENTS.md sets WCAG 2.2 AA as a budget, and visitors cannot see the claim or a contact. | A short statement with a contact. | Low |

## 5. Wiki

Verdict: this is the best-written part of the site. It is specific and honest about limits ("It is not a sandbox", "A command is not undoable", "Voice mode is in beta"). For a beginner it is heavy with jargon, the tables do a lot of work, and several facts conflict (below).

| Page | Verdict | Main issues |
|---|---|---|
| Home (`en.html:1` to `18`) | Good structure. | Line 3 overclaims (2.21). |
| Installation (`:19` to `70`) | Clear. | Two different macOS commands (W6). "Several gigabytes" (1.5). Timings (1.4). |
| Choosing a model (`:72` to `190`) | Most useful page. | Model names and tables need dating (1.3). Mac table errors (W7). "The number that matters" heading (2.8). 60% conflict (W4). |
| Providers (`:200` to `260`) | Good. | "Never sees your password" (2.18). providers.json (7). zh term conflict (6.4). |
| Chat and Code (`:280` to `340`) | Good. | Ctrl+K (W1). |
| Projects (`:342` to `400`) | Good. | "Recycle bin" (W14). |
| Permissions (`:404` to `430`) | Good. "Reading never asks" is clear. | The default-mode table is correct, which makes home.f3Text wrong (2.2). |
| Commands (`:461` to `530`) | Good prose. | Keyboard shortcuts are misfiled under Commands (W3). Empty key cell (W2). "Asks in every mode except Auto" (W15). |
| Plans and tasks (`:540` to `575`) | Good. | None found. |
| Tools (`:579` to `640`) | Good. | Check run_code's 20-second limit (1.4). |
| Extensions (`:642` to `705`) | Good. | "Only extension that sends" (2.19). "107 servers" (section 7). |
| Voice (`:712` to `790`) | Good, and honest that it is beta. | "Your audio is not uploaded" (7). Speed range and 1500 ms (1.4). |
| Settings (`:795` to `885`) | Good tables. | Privacy overclaim (W10). |
| Privacy (`:846` to `905`) | Good tables. | "No telemetry" (1.6). "None of the requests above are made" (W10). |
| Troubleshooting (`:915` to `985`) | Thin in one place. | Splash-screen section is one sentence with no steps (W5). Slow-reply threshold conflict (W4). "The model may be too small" (1.1). |
| Development (`:990` to `1095`) | Contributor content in the user wiki. | Label or split it. "Two boundaries" is unexplained. |

### Findability

- The sidebar has five groups, "New here?" points to the first two steps, and error pages link back into the wiki. That is good.
- Missing: search, a glossary (2 above), and a "what changed" page.
- Stale risk: model names, the Mac table, the shortcut table, "Settings → Chat → Talk", the 107 and 66 counts, and the ad-blocker list providers.

### Specific wiki findings

- **W1 Ctrl+K conflict.** Composer table, `en.html:318`: "Model name ... Ctrl+K changes it." Shortcuts table, `:516`: Ctrl+K is "Open command palette", and Ctrl+Shift+I is "Select model". Rewrite the composer row: "Model name. Ctrl+Shift+I changes it." Confirm which key the app uses.
- **W2 Empty key cell.** `en.html:531`: `<kbd>Ctrl</kbd>+<kbd></kbd>`, "Close the active pane". The same row is blank in fr, es and zh. Fix: fill in the key the app uses, in all four languages (check the app's shortcut list).
- **W3 Shortcuts misfiled.** The shortcuts table sits on the Commands page (`:509`). Move it to Settings, or to a page of its own, and link it from the composer.
- **W4 60% conflict.** `en.html:184`: "Amber, from 60%, runs with part of it on the CPU ... Red, below 60%, is a size too big." `:928`: "Anything under about 60% means the model is spilling onto the processor." Rewrite the troubleshooting line: "If the GPU figure is red (under 60%), step down a size. If it is amber, part of the model runs on the CPU, which is slower." Confirm the thresholds in the app.
- **W5 Thin troubleshooting entry.** `en.html:918` to `921`: "It will not get past the splash screen", then one sentence about download size. Rewrite: name the first-launch download, say where its progress shows (Settings → Models, verify), and give the two things to check (connection, free disk).
- **W6 Two macOS commands.** `en.html:45`: `xattr -cr /Applications/Draggy.app`. `en.json:48` (`firstRun.macos`): `xattr -dr com.apple.quarantine /Applications/Draggy.app`. Pick one, test it on current macOS, and use it in both places. The `-dr com.apple.quarantine` form removes only the download flag; `-cr` clears all extended attributes.
- **W7 Mac table errors.** `en.html:157` to `175`. Each row needs a check against Apple's current specs:
  - "Every Mac with Apple silicon" is an absolute. Apple has shipped M5-family Macs since October 2025 (verify), so "M1 to M4" is out of date.
  - MacBook Pro 13-inch shows only the 2020 M1 model (`:165`). The 13-inch MacBook Pro with M2 (2022) is missing (verify).
  - iMac (`:168`) says 8 to 24 GB. The 2024 24-inch iMac with M4 is, I believe, offered up to 32 GB (verify).
  - "A Mac from 2019 or earlier is Intel" (`:175`) leaves out 2020 Intel models (verify).
  - "It has a real, separate graphics card" is not true for many Intel Macs, which use integrated graphics (verify).
- **W8 Unverifiable path.** `en.html:198`: "Settings → Chat → Talk" for the talk model. Verify the menu path in the app before publishing.
- **W9 Engine names.** The wiki says "an embedded engine (llama.cpp)" (`:3`) and "llama-server" (`:1084`). The error pages say "colibri" (11 times, first at `errors/en.html:553`) and an "image engine" in other errors. Neither the wiki nor a glossary defines colibri. Rewrite the wiki home line: "Draggy runs models with its built-in engine, which is based on llama.cpp. Some models use a second engine, colibri." Then say when.
- **W10 Privacy overclaims.** `en.html:853`: "There is no account and no telemetry." (verify for the app; see 1.6). `:869`: "Ad blocker lists | GitHub, EasyList, OISD". `:882`: "Set web search to Off ... none of the requests above are made." The ad-blocker row is not switched off by those steps. Rewrite the last sentence: "Set web search to Off, leave extensions off, add no cloud provider, and turn off update checks. Model downloads and ad-blocker list updates still happen. Each is listed above."
- **W11 Log safety claim.** `en.html:988` and `:1060`: `app.log` is "safe to share" because inputs are reduced to hashes. But `:1058` says it also records "tool calls". Tool calls can carry file paths. Verify what `app.log` holds for a tool call. If paths appear, rewrite: "app.log does not include your messages, but it can include file names. Check it before you share it." `en.json:107` says "is safe to share" without that caveat.
- **W12 Credential storage claim.** `en.html:236`: "The key is encrypted with your system's keychain before it is saved." Verify, then keep. If it is true, name the store on each OS.
- **W13 Public-network claim.** `en.html:585` to `586`: `search_web` and `read_url` accept "http and https on the public internet only". Verify the enforcement and whether private ranges are blocked.
- **W14 Recycle bin.** `en.html:369`: "A deleted file went to the recycle bin." Problem: "recycle bin" is a Windows term. macOS uses Trash. Rewrite: "A deleted file goes to the system trash or recycle bin."
- **W15 Commands and Plan only.** `en.html:464`: "It asks in every mode except Auto". The permission table (`:415`) says Plan only cannot run commands at all. Rewrite: "Commands never run in Plan only. In Ask first and Accept edits they ask. In Auto they run."
- **W16 Title and heading style.** `en.html:134` "Apple Silicon" (1.10). `en.html:180` (2.8).

## 6. Translations

### 6.1 Parity and the checker

- `npm run i18n` passes: all four languages have all 222 keys, and no key is in a translation that is not in English.
- The checker's "no page uses these 11 strings" list is wrong. The 11 keys are `errors.title`, `errors.description`, `errors.ogTitle`, `errors.ogDescription`, `errors.group.*` (4), and `privacyPolicy.description`, `.ogTitle`, `.ogDescription`. They are used through `${page.id}.title` and `errors.group.${key}` in `build.mjs`. The regex looks for `^error\.` (singular), so it misses them. Fix the regex, and add a check for the mojibake below.

### 6.2 Encoding corruption in `es.json`

Twelve keys contain double-encoded UTF-8 (the UTF-8 bytes of "ó" read as CP437, giving "├│"):

- `index.ogDescription`: "edita c├│digo"
- `hero.lede`: "edita c├│digo"
- `alt.browser`: "p├ígina", "navegaci├│n", "puntuaci├│n"
- `firstRun.lede`: "est├í firmada, as├¡"
- `firstRun.checksums`: "versi├│n"
- `wiki.models.description`: "Qu├® mo...", "gr├ífica"
- `wiki.troubleshooting.description`: "qu├® lo"
- `download.checkLede`: "comp├íralo"
- `hw.older.verdict`: "peque├▒os"
- `hw.recent.verdict`: "tama├▒o"
- `hw.disk`: "t├¡pico"
- `home.freeText`: "suscripci├│n", "a├▒ades", "├®l"

Six built pages show it: `public/es/index.html`, `download.html`, `wiki/index.html`, `wiki/models/index.html`, `wiki/tools/index.html`, `wiki/troubleshooting/index.html`. Fix: re-save `es.json` as UTF-8 (the source text is intact, so repairing it is mechanical). Add a test that fails on U+251C, U+2502, U+2500 and U+00C3 in any locale or page.

### 6.3 English left in translations

- `tools/pages/download.html:139` and `:146` hard-code "Apple silicon (arm64)" and "Intel (x64)". All fr, es and zh download pages show them in English. Fix: move both labels to `download.*` keys in all four languages.
- `nav.source` is "Source" in fr (`fr.json`). Rewrite: "Code source".
- `js.version` is "Build" in fr and es. The zh string 构建 is fine. Rewrite es: "Compilación". Keep fr "Build" if that is the app's own term (verify against `translations.ts`).
- Apple silicon in fr and es (`download.appleSilicon`) is kept in English. Acceptable as Apple's term, but check the app.
- No English sentences remain in the translated wiki, error or policy pages (heuristic scan).

### 6.4 Terminology conflicts

- **zh provider:** 提供方 appears 22 times in the wiki and 53 times in the errors, but 服务商 appears in `zh.json` (4) and the zh policy (7). Pick one (check the app), and use it everywhere.
- **zh talk mode:** `home.f4Link` says 语音模式 (`zh.json`, 4 occurrences). The wiki says 语音对话 (6 occurrences) and 语音模式 (2). Pick one.
- **zh chat:** 聊天 and 对话 both mean "chat" in the same files. The zh wiki uses 对话 21 times and 聊天 2 times, and `zh.json` uses both 6 times. Pick one.
- **zh garbled phrase:** the composer's "Context wheel" becomes "上下文环窗口", which reads as nonsense. Rewrite: "上下文用量环" (verify the app's term).
- **zh colloquial:** "Draggy 讲 Model Context Protocol" (wiki extensions). Rewrite: "Draggy 支持 Model Context Protocol".
- **fr approval:** `home.f3Title` is "L'approbation." Rewrite: "La demande d'autorisation" (check the app's term).
- **fr machine translation:** "chaque système proteste une fois" (wiki installation). Rewrite: "chaque système affiche un avertissement une seule fois".
- **es variety:** the copy is Spain-flavoured: "ordenador", "Coge el instalador", "Ajustes". The middleware sends Mexico, Argentina, Colombia and the rest of Latin America to `/es`. Decide on a variety. If it is neutral Spanish, use "computadora" or "equipo" consistently (the file uses both now, "ordenador" 11 times and "equipo" 2 times in `es.json`).

### 6.5 Tone and machine-translation smell

- The fr and es prose is natural overall. The zh prose is natural in most places (read through the Settings page of the wiki).
- Calques to fix: zh "Draggy 讲 ..." (above). That is the only one that reads as a translation artefact in the parts read.
- Punctuation: zh uses full-width punctuation throughout (`，。：`). No ASCII punctuation problems were found in `zh.json` or the zh wiki prose.

### 6.6 Length and layout

- Measured lengths, en to translation: fr and es run about 1.4 to 1.8 times longer on short labels (for example `privacyPolicy.title` 14 to 28 characters in fr, `closer.checksums` 25 to 43, `home.v3Title` 16 to 29). zh runs 0.3 to 0.5 times on descriptions, which is expected.
- Overall visible text: wiki fr is 1.19 times English and es 1.11 times. zh is 0.5 times.
- At 320px, nine sampled pages showed no overflow (see Coverage). The longest labels are buttons and nav entries, and both wrap.

### 6.7 Strings the site never shows (dead payload)

- `table.search`, `table.model`, `table.params`, `table.use`, `table.hardwareVram`, `table.hardwareUnified`, `table.supports`, `table.notes`, `table.all`, `table.count` (10 keys) and `js.yourSystem`: serialized by `strings()` in `build.mjs` into every page's JSON blob. `assets/js/site.js` reads only `copy` and `copied`. Remove them from `build.mjs` and the locale files. Note that `table.use` is "Best use", which would invite model-quality claims if it were ever revived.
- The seven `clip.*.caption` keys (see 2.13). Either wire them or delete them.
- Net: 18 keys, 72 strings, dead in all four languages.

## 7. Factual claims and numbers to verify

Nothing here could be checked against the app. The ones marked "code" were checked against this repo's code. Everything else needs the app at its current version.

### Numbers on the site

| # | Claim | Where | Check |
|---|---|---|---|
| N1 | 107 MCP servers | `site.config.json` `mcp`; wiki `en.html:674` | Count the catalogue (`electron/mcpCatalogue.cjs` in the app). |
| N2 | 66 skills | `site.config.json` `skills`; wiki `:688`; `llms.txt`; meta | Count the library. |
| N3 | 29 skills on by default | `site.config.json` `skillsOn`; wiki `:688` | Count defaults. |
| N4 | Star count hidden below 25 | `site.config.json` `starsMin`; `build.mjs:540` (code) | Matches code. Current stars: 1 in `release.json`. |
| N5 | Version 3.0.1, build 1, tag `b-1` | `release.json`; JSON-LD `build.mjs:456` (code); download page shows "Build 1" | Decide which the site shows, and whether the app's About box matches. |
| N6 | Installer sizes | `release.json`; `build.mjs:962` (code) | Formula divides by 1024 × 1024 and prints "MB" (it is MiB). `site.test.mjs` enforces the same formula. Pick MB (÷1,000,000) or MiB and label it. |
| N7 | SHA-512 values | `release.json`; download page (code: from manifests) | Compare with the uploaded files for all five assets. |
| N8 | Release has all five files | `release.json` | Confirm on the `b-1` release page. |

### Install and requirements

| # | Claim | Where | Check |
|---|---|---|---|
| I1 | Windows 10 64-bit, 1809 or newer | `download.windowsNote` (en.json:40); wiki `:27` | App requirement; see section 4 (Windows 10 end of support). |
| I2 | macOS 12 or newer | `download.macNote` (:42) | App requirement. |
| I3 | glibc 2.28 or newer | `download.linuxNote` (:44) | App requirement. |
| I4 | 8 GB memory, 16 GB comfortable | wiki `:28`; `hw.older.memory`, `hw.recent.memory` | Test on a real machine. |
| I5 | 10 GB free disk | `hw.disk` (:174); wiki `:29` | Measure a default install and model. |
| I6 | Automatic updates check 20 s after launch, then every 6 h | wiki `:61` | App code. |
| I7 | macOS builds cannot update themselves | `firstRun.macos` (:48); wiki `:66` | App code. |
| I8 | Running from source disables updates | wiki `:66` to `:67` | App code. |
| I9 | Two downloads at a time; queue; cancel removes `.download` | wiki `:85` | App code. |
| I10 | Top 100 trending GGUF models | wiki `:80` | App code and Hugging Face query. |

### Models and hardware

| # | Claim | Where | Check |
|---|---|---|---|
| M1 | VRAM to model table (16 rows) | wiki `:110` to `:131` | Match the app's selection logic. |
| M2 | Apple unified memory table | wiki `:141` to `:153` | Match the app's selection logic. |
| M3 | Use at most 80% of system memory; under 2 GB VRAM treated as half system memory | wiki `:103` to `:105` | App code. |
| M4 | 60% amber and red thresholds | wiki `:184` to `:185`, `:928` | App code. |
| M5 | Mac lineup, years and memory | wiki `:157` to `:175` | Apple specs (see W7). |
| M6 | Model names: Qwen 3.5 9B, Qwen 3.6, Qwen 3.8, Gemma 4, GPT-OSS, Ministral 3 | wiki tables; `hw.gpu.verdict` | Each name exists in the catalogue on build 1. |
| M7 | Unload frees video memory without deleting | wiki, "The number that matters" section (`:180` onward) | App code. |
| M8 | Context window; compaction at 60% | wiki `:332` to `:333` | App code. |
| M9 | `/compact-limit 20k`; `auto` restores | wiki `:338` | App code. |

### Permissions and commands

| # | Claim | Where | Check |
|---|---|---|---|
| P1 | Four permission modes and the table | wiki `:404` to `:418` | App code. |
| P2 | Accept edits is the default | wiki `:423` | App code (matters for 2.2). |
| P3 | Commands time out at two minutes; ten if requested | wiki `:489` | App code. |
| P4 | 30,000-character output limit, cut from the middle | wiki `:490` | App code. |
| P5 | PowerShell 7 default on Windows; bash from Git for Windows | wiki `:472` to `:474` | App code. |
| P6 | `GIT_TERMINAL_PROMPT=0`, `PAGER=cat`, `NO_COLOR=1` | wiki `:481` to `:482` | App code. |
| P7 | Git tools never commit or fetch | wiki `:392` | App code. |
| P8 | Refused folders (`.ssh`, `.aws`, ...) and files; 2 MB limit | wiki `:359` to `:361` | App code. |
| P9 | Fast turns off reasoning | wiki `:316` | App code. |
| P10 | 60% compaction point | wiki `:332` | App code (also M8). |
| P11 | Shortcut table (about 24 rows) | wiki `:509` to `:535` | Every row against the app. |
| P12 | Ctrl+K | wiki `:318`, `:516` | See W1. |

### Tools, voice, browser and extensions

| # | Claim | Where | Check |
|---|---|---|---|
| T1 | `run_code` stops after 20 s | wiki `:624` | App code. |
| T2 | Ad blocking uses uBlock Origin lists on Ghostery's engine | wiki `:590` | App code and licence check for both. |
| T3 | Cloudflare or captcha pages are reported as needing a person | wiki `:602` | App code. |
| T4 | Whisper base; Moonshine base for English | wiki `:776` | App code. |
| T5 | Natural voice in English, French and Spanish; 0.9x to 1.25x | wiki `:763` to `:765` | App code. |
| T6 | 1500 ms latency threshold | wiki `:784` | App code. |
| T7 | Voice mode is beta | wiki `:720` | Still true? Keep only if so. |
| T8 | "Your audio is not uploaded" | wiki `:777` | App code. |
| T9 | Sign-in uses OAuth with PKCE | wiki `:683` | App code. |
| T10 | Install scripts refused; no shell involved | wiki `:662` | App code. |
| T11 | Nothing on by default | wiki `:667` | App code. |
| T12 | Local API on `127.0.0.1:11500`; Bearer key; Origin refused | wiki `:844` to `:847` | App code. |
| T13 | Local servers scanned: Ollama, LM Studio, llama.cpp, vLLM, SGLang, Jan, LocalAI, KoboldCpp, text-generation-webui, GPT4All, llamafile, MLX-LM, Lemonade | wiki `:213` to `:217` | App code. |

### Privacy and network

| # | Claim | Where | Check |
|---|---|---|---|
| L1 | No account and no telemetry (app) | wiki `:853`; `index.description`; `og.meta` | App code. |
| L2 | Update check goes to GitHub releases | wiki `:871`; policy | App code. |
| L3 | Ad-blocker lists from GitHub, EasyList and OISD, and when | wiki `:869`; policy `:35` | App code. |
| L4 | Provider list from `draggy.org/providers.json` | policy `:43` (all four languages); wiki `:257` | The file is not in the repo or `public/`. Either the app does not fetch it, or it 404s. |
| L5 | Google may keep and review Gemini prompts | policy `:47` | Check Google's current Gemini privacy notice. |
| L6 | Claude sign-in downloads from `downloads.claude.ai` | policy `:39` area | Check the host. |
| L7 | Codex from GitHub, Gemini CLI from npm | policy | Check. |
| L8 | Credentials encrypted with the OS keystore | wiki `:236`; policy `:7` | App code (W12). |
| L9 | `draggy-lang` cookie lasts one year | policy `:57` | Matches `assets/js/site.js:121` (`max-age=31536000`). Verified in code. |
| L10 | Vercel analytics: hashed visitor ID discarded within a day; records country, browser, system and device | policy `:55` | Check Vercel's documented behaviour. |
| L11 | Policy "last updated 2026-09-30" | `tools/pages/privacy-policy`; policy | Update when the policy changes. |
| L12 | `app.log` safe to share | en.json:107; wiki `:988`, `:1060` | See W11. |
| L13 | Logs rotate at 5 MB, three archives | wiki `:1070` | App code. |

### Errors and engine

| # | Claim | Where | Check |
|---|---|---|---|
| E1 | Load timeout between 30 seconds and 3 minutes | `errors/en.html:265` | App code. |
| E2 | Engine on port 11435 | `errors/en.html:204`; wiki `:1084` | App code. |
| E3 | Only `.gguf` files work | `errors/en.html:159` | App code. |
| E4 | Split models named `model-00001-of-00004.gguf` | `errors/en.html:185` | App code. |
| E5 | colibri is the engine for some models | `errors/en.html:553` | App code (W9). |
| E6 | Smart App Control may block the engine | `errors/en.html:629` | Check current Windows behaviour. |
| E7 | Dev port 5173 | wiki `:1001` | App code. |
| E8 | Logs and log files in `logs/` | wiki `:1057` to `:1070` | App code. |

### Site and repo

| # | Claim | Where | Check |
|---|---|---|---|
| S1 | GitHub owner `Lucki74` in every link | `build.mjs:33` (code); `vercel.json`; release data | Confirm it is the public owner and that the repo is public. |
| S2 | Repo has LICENSE, SECURITY.md, CONTRIBUTING.md, README anchor `#building-from-source`, and tag `b-1` | `build.mjs` (code); wiki `:1091` and `:1093`; `download.html` | Check each link resolves. |
| S3 | Apache 2.0 | many | Check the licence file. |

## Other findings (repo, not copy)

- **AGENTS.md line 80 is out of date.** "The site has no cookies" conflicts with `draggy-lang` (`assets/js/site.js:121`, `middleware.js:54`). Update AGENTS.md, or remove the cookie if the rule is intended.
- **`.impeccable/briefs/home.md` is stale.** It specifies Mona Sans and Geist Mono, an "ember" glow, a translucent sticky nav, 12 to 20px radii, and a star count in the first viewport. AGENTS.md bans glow, blur and buttons over 12px, and the site uses Geologica. Either update or delete the brief.
- **Tests miss the problems above.** No test checks for mojibake, clip captions, or copy claims. `site.test.mjs` enforces the MiB-labelled-as-MB formula (N6).
- **`hero.lede` is unused on the page** (see 3.1). It is only in `llms.txt`.
- **`llms.txt` wording.** "Build 1, for Windows, macOS and Linux." is a fragment, and "on your own computer" appears twice in the same paragraph. Rewrite the second sentence: "Draggy is a free desktop AI assistant for Windows, macOS and Linux. Build 1."
- **Meta titles.** Non-wiki titles lack the "· Draggy" suffix that wiki titles have (for example "Privacy policy"). Pick one rule.
- **Wiki description for models** (`wiki.models.description`, en.json:69): "Which model fits your graphics card." It ignores Macs, which are most of the Apple table. Rewrite: "Which model fits your memory or graphics card."
