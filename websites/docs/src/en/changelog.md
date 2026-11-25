---
title: "Changelog"
description: "Where release notes live and how versions are numbered."
section: reference
---

Every build of Draggy is a release on GitHub, with its notes and installers: [Draggy releases](https://github.com/Lucki74/draggy/releases).

## Build 13

- Draggy starts in a small window that checks for an update, downloads it and restarts into the new version. **Start without updating** skips it.
- After an update, the startup window shows the new version.

### Fixes

- Every skill in the built-in library is installed.
- Long messages in non-Latin scripts are no longer treated as binary.

### Security

- Commands run as administrator no longer go through a hidden PowerShell window.

## Build 12

- Answers show generated or web-found pictures; click one to open the image viewer.
- Cloud image models from a connected provider appear in Settings next to local models.
- Cloud voice model and voice name can be picked in the Talk settings.
- Statistics price local replies at the OpenRouter rate of the model they are based on, with a cost by model breakdown.
- Steer notes can be taken back and edited.
- Research marks quotes not found on the page and lists sources per run.

### Fixes

- The cloud default model opens at startup.
- llama.cpp no longer reuses a stale context.
- Web search during research waits for the cooldown.
- The browser pane opens when the agent visits a page.
- The voice "Loading voice model" state is fixed.

### Security

- Private addresses found through DNS are blocked.
- More executable types are refused.
- Scripts and installers open in their folder instead of running.

## Build 11

Version 3.0.11, tagged `b-11` on GitHub.

- The Windows app runs on Tauri instead of Electron. Settings, chats and saved keys carry over, and the old install is removed after the upgrade.
- On Windows, agent commands run in a sandbox that sees the project folder and the toolchains on your PATH.
- npm, npx, vitest and other Node tools ask once, then run outside the sandbox, where they work.
- **Always allow here** covers a command prefix, so allowing `npm run` covers every script.
- The browser pane blocks more ads, scriptlet filters included, and its popped-out window has its own bar.
- Window controls are drawn in the app's title bar.

### Fixes

- Node commands no longer hang in the sandbox and get retried for dozens of steps.
- The administrator prompt for the sandbox appears once per computer, not at every launch.
- Sandboxed commands can list the folders above the project, so PowerShell and `dir` work there.

## Build 10

Version 3.0.10, tagged `b-10` on GitHub.

- Draggy updates itself on Windows, macOS and Linux. It checks at every launch, within a 4 second budget, and every 6 hours. It installs a found update in a small Updating Draggy window and relaunches. A late result installs on quit or from a dismissible restart notice. There is no Updates setting any more.
- macOS downloads the zip itself, checks its SHA-256 and swaps the app bundle after Draggy exits. If the folder is not writable, it opens the release page.
- Linux downloads and verifies the update in the background, then installs the .deb or .rpm with pkexec from the restart notice. Flatpak does nothing. Without pkexec, it opens the release page.
- Releases carry a SHA256SUMS.txt file.
- Every tool call shows live in chat: its name and arguments appear while the model is still writing them, and its steps stay with the chat when you reopen it.
- Read-only tool calls run in parallel.
- Deep research, Fact check, News brief and Trend scan read sources, keep them in a research library and cite them in the answer.
- Assistant turns are redesigned: the work of a turn folds into one summary. Diff panes, history and the git graph are reworked on every platform.
- Russian replaces Chinese as an interface language. The app's screens are in English, French, Spanish and Russian.
- AMD graphics cards use the ROCm build of llama.cpp automatically when it is published. There is no setting for it.

### Fixes

- Removed the Gemini account provider.

## Version numbers

A release has a build number and a version. Build 11 is version 3.0.11 and is tagged `b-11` on GitHub.

## Getting a new version

Draggy updates itself on Windows, macOS and Linux. [Installation](doc:installation#updates) has the details.
