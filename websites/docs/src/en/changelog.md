---
title: "Changelog"
description: "Where release notes live and how versions are numbered."
section: reference
---

Every build of Draggy is a release on GitHub, with its notes and installers: [Draggy releases](https://github.com/Lucki74/draggy/releases).

## Build 18

- API keys save on every Mac and Linux system. A key file tied to the machine encrypts them, so no system keychain is needed.
- On macOS the window uses the system traffic lights, closing it keeps Draggy in the Dock, and MCP servers no longer add a second Dock icon.
- Chats export as PDF, and PDF export works on macOS.
- Settings has **Check for updates** and a **Default shell** for new terminals, which otherwise open your login shell.
- MCP servers install with the npm that ships with Draggy.

### Fixes

- The browser pane's address bar and back and forward buttons work on macOS and Linux.
- Folders that are not Git repositories no longer fill the log with Git errors.

## Build 17

- Draggy runs on the same Tauri app on Windows, macOS and Linux.
- macOS is back as one universal app for Apple silicon and Intel Macs on macOS 14 or newer. It is signed ad hoc, so right click it and pick **Open** the first time.
- Linux gets an AppImage next to the .deb and .rpm packages.
- Every system updates itself from its own signed feed. On Windows, build 16 can't update by itself: install build 17 by hand once.
- Video tools on macOS and Linux use a bundled ffmpeg.
- Models from an added provider have an on/off switch and start switched on.
- The context window is read from llama.cpp and vLLM model lists.

### Fixes

- Adding a Custom (OpenAI-compatible) provider works again.
- Free disk space is right on macOS.
- Chat stays visible when the side pane is dragged wide.
- Web searches no longer come back empty when a search engine shows a bot check.

## Build 16

- macOS builds were paused; this build shipped for Windows and Linux.
- Download errors say what to do about a full disk, a folder you can't write to, a bad checksum or a blocked address.
- Skills switched on past the 40th can still be used.

### Fixes

- Model downloads on Windows no longer fail with "URL refused by outbound security policy".
- Closing or crashing Draggy no longer leaves llama-server or shell processes running.
- MCP tools that only claim to be read-only ask before they run, and web fetches stop at 16 MiB.
- When several files change at once, every one is picked up, so open canvases no longer go stale.
- Enter with an input method editor, Escape in menus and rename, and retry on the crash screen work again.

## Build 15

### Fixes

- The AI can read attached videos again.

## Build 14

- Videos can be attached to a chat.
- The local API speaks the tool and message formats of Codex, Claude Code, Cline and Open WebUI.

### Fixes

- Replies in chats signed in with an account are no longer empty.
- Tool calls and follow-up messages in ChatGPT chats work.
- Browser tool calls show as completed instead of failed.

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
