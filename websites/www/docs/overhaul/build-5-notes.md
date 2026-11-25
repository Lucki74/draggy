# Build 5 site pass: notes and open decisions

> **Stale citations.** The app paths in this file point to the old Electron checkout (`electron/`, `draggy-main`). The app is now Tauri in `draggy-tauri`, so file and line references below do not match it. Treat the verdicts as history, not as current facts.

## Done

- Download page: Windows card first, macOS and Linux in a closed block titled "coming back soon". The requirements row now has four entries (system, memory, disk, graphics card), each checked against the app: Electron 44 ships a 64-bit installer only (`electron-builder` nsis target), the model must fit in 80% of system memory (`USABLE_RAM_FRACTION`), setup needs 1.5 times the model's size free, and a graphics card is optional (`effectiveBudget` floors a machine without one on half its RAM).
- The "1809 or newer" Windows build was cut. No source or test in the app confirms it (see `facts.md`, row 40).
- Pricing page at `/pricing` in four languages: free for all users, stays free, any later cloud feature will be billed.
- The build number shows once, in the footer.
- Home title carries the search terms. `llms.txt` has a facts block and the pricing page.
- The site accent follows the app's new default, vermilion `#d55e00`. Text uses `--accent-text` (5.2:1 on white), and button labels use `--accent-ink`.
- Sections on the home page rise into place on scroll (CSS scroll-driven animation, transform only, no effect where unsupported or under reduced motion).
- Added the missing `account-access-denied` error page (the app named it in an earlier phase).

## Not done

- **Screenshots and clips (W1).** `win/scripts/screenshots.cjs`, `wiki-shots.cjs` and `clips.cjs` need a built renderer, the demo models on disk and a live run. Run them from `win/` after `npm run build`:
  `DRAGGY_RENDERER=dist npx electron scripts/screenshots.cjs`, then the other two the same way. Update `shots.json` afterwards.
- **Wiki rebuild (W2).** Waiting for your answer on the structure below.

## W2 proposal: wiki structure (not built)

Today: five sections, 16 pages. Proposed: group by what a reader is trying to do, and give each page one job.

1. **Get started**: Installation, Choosing a model, Your first chat.
2. **Use Draggy**: Chat and Code, Projects, Plans and tasks, Voice mode, Browser.
3. **Control it**: Permissions, Commands, Tools and capabilities, Extensions and skills.
4. **Providers and models**: Providers (ChatGPT, Claude, Google, API keys), Local engines.
5. **Reference**: Settings, Security, Privacy and data, Glossary.
6. **Fix a problem**: Troubleshooting, the error index.
7. **Build on it**: Building and architecture.

New pages: Your first chat, Browser, Local engines. Merged: none. Every page gets a one-line summary at the top that answers "what is this for". Decide: keep the 16 existing URLs working with redirects, yes or no.

## Repeated headline items (keep or move)

These say the same thing in several places on the home page. Pick one home for each.

- "Free": the hero, the values row, the FAQ, the closing section, and now `/pricing`.
- "No account": the hero, the values row, the FAQ.
- "Runs on your computer": the hero, the values row, the hardware section, the closing section.
- "Open source": the values row, the footer licence line, `/open-source`.

## W7: ranking for the four terms

Checked 2026-10-21. A search for "Draggy local AI assistant" lists the project's GitHub wiki and a third-party directory, not draggy.org. A search for "local AI harness open source desktop coding agent" lists OpenPilot, Localforge, PI-Desktop and others. A commercial email product, Drag, shares the name.

What is in place: the home title and `llms.txt` carry "free local AI coding agent and harness".

What helps, in order:

1. Submit the site in Google Search Console and Bing Webmaster Tools, and submit `sitemap.xml`. Check that the home page is indexed.
2. Make the GitHub repository say the same thing: put "local AI coding agent and harness for Windows" in the description and topics, and link `https://draggy.org` as the website. The wiki ranks now, so link from it to the site.
3. Get listed where these terms are searched: the directory that already lists Draggy, awesome-lists for local AI and desktop agents, Product Hunt and Hacker News when a release is worth it.
4. Write one page that answers "what is an AI harness" in plain terms, and how Draggy is one. Link it from the wiki glossary.
5. Keep "Draggy" next to "AI" in titles and headings, so it does not read as the Drag product.

No ranking can be promised. "harness" alone is a generic word, so expect to rank for the longer phrases first.
