# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Renderer of an Electron desktop app for Windows, macOS, and Linux. The design language is custom rather than OS native.

## Users

People who want an AI assistant running locally on their own computer, without an account, an API key, or data leaving the machine. Two main workflows share one window: conversational chat and voice (Chat and Talk), and working inside a project repository (Code). The Code user overlaps with Claude Code users; the Chat user may rarely open a terminal.

## Product purpose

A desktop assistant that speaks, searches, and works in project folders, using models running on local hardware through an embedded llama.cpp engine with GGUF weights from Hugging Face. Mixture-of-Experts models too big for memory run slowly from the drive on a second engine, colibri, and Draggy says so up front. Cloud providers and cloud voices are optional, and a cloud voice needs a grant per provider before any reply text leaves. The goal is a local workflow capable enough that most users never need external APIs.

## Positioning

Local first by default: no account, no telemetry, and no outbound requests unless specifically asked. Voice conversation acts as the primary differentiator. Free and open source under Apache 2.0, with a NOTICE file preserving the Draggy name on distributed copies.

## Operating context

Long desktop sessions with a project directory open, a built-in browser on an isolated partition, file preview, a git strip, approval cards for edits and shell commands, permission modes (plan, ask, acceptEdits, auto), and a hands-free voice mode. The application runs on consumer GPUs and CPUs, sharing system resources with an active local model.

## Capabilities and constraints

- The renderer communicates with Node only through `electron/preload.cjs`.
- Strict CSP on the default session: no remote fonts, scripts, or images. External pages run in partition `persist:draggy-web`.
- Four UI languages with complete translation key parity: English, French, Spanish, and Chinese. Talk speaks the selected UI language.
- Child processes launch through `platform.spawnHidden` or `platform.execFileHidden`; never `npx`.
- Single instance lock enforced at startup. Sensitive logs store hashes rather than raw prompts.
- Downloads that get run (engines, the private Python runtime) are verified against a SHA-256 before use. The app downloads them only when the user asks.
- Provider logos in `src/providers/icons/` are third-party trademarks credited in NOTICE.

## Brand commitments

- Name: Draggy. Mascot: `src/assets/dragon.png`. Logo component: `src/Logo.tsx`.
- Tone follows the house style in CONTRIBUTING.md.
- The mascot image remains fixed. Its position is limited to the title bar, Talk view, and startup screen.
- Visual style: ink and cool greys at rest, an amber signature that appears only while tasks run, Geologica for interface typography, JetBrains Mono for code, and Phosphor icons.

## Product principles

1. Nothing leaves the computer unless the user initiates it, with network activity visible in the UI.
2. The user controls model actions through permission modes, explicit approvals, and diff previews.
3. Voice conversation is a core interaction path, not a secondary accessory.
4. Interface rendering remains lightweight so local model inference retains most system resources.

## Accessibility and inclusion

Chinese interfaces use system font stacks because Geologica lacks Han glyphs. Interface styles use logical directional properties rather than physical left/right rules. Reduced-motion preferences in `src/index.css` pause particles and replace sliding animations with instant cuts. Target contrast and focus indicators follow WCAG 2.2 AA standards.
