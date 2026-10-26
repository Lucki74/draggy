# Draggy UI overhaul release notes

## Overview

Draggy now uses a redesign built on neutral surfaces, tighter typography, Phosphor icons, and an amber accent that only shows while the engine is running.

## Visual and layout changes

### Collapsible sidebar (`Ctrl+B`)
The navigation rail is replaced by a resizable sidebar (220px to 360px).
- A segmented control switches between Chat and Code modes.
- Chat mode groups sessions by recency and pinned chats; Code mode lists project directories.
- The footer shows engine status (ready, generating, or loading), a model picker, and settings.

### Command palette and shortcuts (`Ctrl+K`, `Ctrl+/`)
- `Ctrl+K` or `Ctrl+Shift+P` opens a command palette to search sessions, workspaces, panes, models, and settings.
- `Ctrl+/` opens a reference sheet listing all keyboard shortcuts.

### Dock and side panes (`Ctrl+\`)
Panes sit in a collapsible end-side dock:
- Diff pane (`Ctrl+Shift+D`): side-by-side or unified view with inline additions, removals, and a git branch selector.
- File pane: view code and files directly beside the chat.
- Browser pane (`Ctrl+Shift+B`): sandboxed web browser running on an isolated session partition.
- Plan pane: task checklist with step approvals.
- Usage pane: token usage and context breakdown for the current conversation.

### Conversation and transcript
- Assistant messages render as plain text directly on the canvas, without speech bubbles or avatar containers.
- Consecutive tool steps collapse into summaries such as "Read 3 files, edited 1 file", with expandable step output.
- Pending tool approvals can be answered directly using number keys `1`, `2`, or `3`.
- Screen readers receive announcements through polite live regions when turns finish or approvals appear.

### Ember indicators
The interface stays neutral when idle. Warm ember accents show active work:
- Spark: small flickering dot on generating sessions, active tool steps, and thinking passes.
- Caret: vertical gradient bar following streaming tokens.
- Fuse: progress line across the composer top edge for model loading and step runs.
- Hearth glow: subtle line along the window bottom while the microphone is listening.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+K` / `Ctrl+Shift+P` | Open command palette |
| `Ctrl+/` | Show keyboard shortcuts sheet |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+N` | New session |
| `Ctrl+,` | Open settings |
| `Ctrl+Shift+D` | Toggle diff pane |
| `Ctrl+Shift+B` | Toggle browser pane |
| `Ctrl+Shift+Space` | Enter Talk mode |
| `Ctrl+Shift+M` | Select permission mode |
| `Ctrl+Shift+I` | Select model |
| `Ctrl+Shift+E` | Select reasoning effort |
| `1`, `2`, `3` | Answer pending approval |
| `F6` | Cycle focus through sidebar, transcript, composer, and dock |
| `Esc` | Stop generation or close active overlay |

## Supported languages

Draggy now supports four languages:
- English (`en`)
- French (`fr`)
- Spanish (`es`)
- Chinese (`zh`)

This keeps every translation key in parity across the interface. Installs previously set to German, Italian, Portuguese, Dutch, Russian, Japanese, Korean, or Arabic migrate to English automatically on launch.
