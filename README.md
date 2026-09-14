<div align="center">

<img width="96" height="96" alt="Draggy" src="https://github.com/user-attachments/assets/746650c8-1251-443f-a323-43ed7dee89ec"/>

# Draggy


[![Website](https://img.shields.io/badge/Website-draggy.org-2b2b2b?style=flat)](https://draggy.org)
[![Download](https://img.shields.io/badge/Download-installers-2b2b2b?style=flat&logo=github&logoColor=white)](https://github.com/Lucki74/draggy/releases)
[![Documentation](https://img.shields.io/badge/Docs-wiki-2b2b2b?style=flat&logo=readthedocs&logoColor=white)](https://github.com/Lucki74/draggy/wiki)

[![Release](https://img.shields.io/github/v/release/Lucki74/draggy?style=flat&label=release&color=2b2b2b)](https://github.com/Lucki74/draggy/releases/latest)
[![Build](https://img.shields.io/github/actions/workflow/status/Lucki74/draggy/ci.yml?style=flat&label=build&logo=githubactions&logoColor=white)](https://github.com/Lucki74/draggy/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/Lucki74/draggy?style=flat&label=license&color=2b2b2b)](LICENSE)

[![Windows](https://img.shields.io/badge/Windows-2b2b2b?style=flat&logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2ZmZiI+PHBhdGggZD0iTTMgNS43IDEwLjQgNC41djcuMUgzek0xMS41IDQuMyAyMSAzdjguNmgtOS41ek0zIDEyLjdoNy40djcuMUwzIDE4LjZ6TTExLjUgMTIuN0gyMVYyMWwtOS41LTEuM3oiLz48L3N2Zz4=)](https://github.com/Lucki74/draggy/releases/latest)
[![macOS](https://img.shields.io/badge/macOS-2b2b2b?style=flat&logo=apple&logoColor=white)](https://github.com/Lucki74/draggy/releases/latest)
[![Linux](https://img.shields.io/badge/Linux-2b2b2b?style=flat&logo=linux&logoColor=white)](https://github.com/Lucki74/draggy/releases/latest)

![Electron](https://img.shields.io/badge/Electron-47848F?style=flat&logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat&logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-06B6D4?style=flat&logo=tailwindcss&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat&logo=sqlite&logoColor=white)
![Ollama](https://img.shields.io/badge/Ollama-2b2b2b?style=flat&logo=ollama&logoColor=white)

</div>

> [!WARNING]
> **Install from official sources only.** Draggy comes from this repository, its
> [releases page](https://github.com/Lucki74/draggy/releases) and
> [draggy.org](https://draggy.org). Nothing is code signed, so a re-upload
> elsewhere is indistinguishable from a tampered build.

Draggy is a desktop AI assistant that talks, browses and works on your own
projects, all on models running on your own computer.

It drives a local [Ollama](https://ollama.com) instance, so there is no account,
no API key, and no request leaving the machine unless you ask for one. An
Electron app, in React and TypeScript, for Windows, macOS and Linux.


## What it does

- **Chat with a local model.** Draggy picks a model that fits your graphics card,
  downloads it, and lets you swap it any time.
- **Keep chats and code apart.** A switch at the top of the sidebar, and each
  side keeps its own history, model and settings.
- **Work in your projects.** Open a folder and it reads, edits and runs commands
  there, showing every change as a diff you can undo.
- **Decide how much it may do.** Four permission modes, from only proposing to
  working alone. Anything outside the mode asks first.
- **Steer the plan.** Tick, reorder and edit its checklist while it works, and
  let tasks carry on in the background.
- **Search, browse and make files.** Web search, a built-in browser that blocks
  adverts, and Word, PowerPoint, Excel and PDF files.
- **Search your own documents.** Point it at a folder, indexed on your machine
  and searched by meaning and keywords at once.
- **Extend it.** Thirty-four MCP servers, the official registry and remote
  servers, plus 64 skills you start with / or leave to the model.
- **Talk to it.** A voice mode that knows when you have finished, answers out
  loud, and stops when you interrupt.
- **Plug other tools in.** An optional OpenAI-compatible API on 127.0.0.1, off
  by default and protected by a key.

## Requirements

Ollama has to be installed and running. Draggy will offer to install it if it
cannot find it.

### Minimum
| | |
| --- | --- |
| System | Windows 10 64-bit (1809 or newer), macOS 11, 64-bit Linux with glibc 2.28 or newer |
| Processor | Intel Core i5-8250U, AMD Ryzen 3 3200U, Apple M1 |
| Memory | 8 GB |
| Graphics | Intel UHD 620, AMD Radeon Vega 8 |
| Disk | 10 GB free |

### Recommended
| | |
| --- | --- |
| System | Windows 11, macOS 14, Newest Linux |
| Processor | Intel Core i5-12400, AMD Ryzen 5 5600, or Apple M2 |
| Memory | 16 GB |
| Graphics | GeForce RTX 3070, Radeon RX 7600, Intel Arc A750 |
| Disk | 20 GB free (SSD) |

## Installing

Pick your system on [draggy.org](https://draggy.org), or take the installer
straight from the [Releases page](https://github.com/Lucki74/draggy/releases),
and run it. Draggy updates itself in the background and offers to install on
the next launch.

Nothing is code signed, which is a certificate I have not bought rather than
anything wrong with the build. Windows shows a SmartScreen warning: **More
info**, then **Run anyway**. macOS needs the quarantine flag cleared with
`xattr -cr /Applications/Draggy.app`, and cannot update itself. Each release
includes a SHA-512 if you would rather check than trust.

## Building it yourself

```bash
npm install
```

```bash
npm run electron:dev
```

Vite and Electron together with hot reload. `npm run electron:build` produces an
installer in `dist-electron`, and `npm run check` is typecheck, lint and around
1,800 tests in a few seconds. See [CONTRIBUTING.md](CONTRIBUTING.md) before
sending a patch, and [RELEASING.md](RELEASING.md) for how versions are cut.

## How it is laid out

```
electron/       main process: windows, IPC, SQLite, the file guard and
                checkpoints, git, search, the embedded browser, code
                execution, MCP servers and widgets, the local API, updates
src/            the React app
src/app/        the shell: sidebar, routing, sessions, running tasks
src/agent/      the tool-calling loop, permissions, compaction, subagents
src/chat/       the message list, diffs, approvals, the context wheel
src/canvas/     the editor beside the chat
src/files/      the file explorer and tree
src/project/    project memory, the git strip
src/plan/       the editable plan
src/extensions/ MCP servers, remote servers and skills on one screen
src/settings/   settings: the app, Chat and Code pages
src/stats/      the statistics page
src/tools/      tool definitions and the registry they live in
src/voice/      capture, voice activity detection, turn-taking, speech
src/__tests__   everything that can be tested without a GPU
```

Two boundaries matter. `electron/preload.cjs` is the security one: the renderer
has no Node access and reaches the filesystem, network and database only through
what is exposed there. Behind it, `electron/fsGuard.cjs` decides which paths a
conversation may touch, and every tool call goes through the permission check in
`src/agent/permissions.ts`. The second is the session split, with Draggy's own window
under a strict Content Security Policy and every external page on a separate
partition with no policy of ours imposed on it.

Quitting writes any conversation not saved yet, then stops everything Draggy
started: browser windows, extension servers, a code run or command still going,
and Ollama if Draggy was the one that started it.

[Architecture](https://github.com/Lucki74/draggy/wiki/Architecture) has the rest.

## Privacy

The only things that reach the internet are model downloads, searches you or the
model trigger, pages the browser opens, the speech models on first use, the ad
blocker's filter lists, site icons for search results, the update check, a
registry search when you type one, and any extension you switch on, remote ones
and their sign-in included. Everything else is local, statistics included. The
local API opens a port only if you turn it on, and only on 127.0.0.1. There is
no telemetry and nowhere for it to go.

## Languages

English, French, Spanish, German, Italian, Portuguese, Dutch, Russian, Chinese,
Japanese, Korean and Arabic. Whether the model answers in your language depends
on the model, not on Draggy.

## Known rough edges

- Voice mode is beta. It wants a decent GPU and a headset; over laptop speakers
  the model will occasionally answer itself.
- macOS builds are unsigned, so they need the quarantine flag cleared and cannot
  update themselves.
- Tool calling quality varies a lot by model, and small models get it wrong.
- A long conversation is condensed into notes as it approaches the context
  window. The messages stay on screen and stay searchable; the model works from
  the summary. `/compact` does it on demand and `/compact-limit` moves the point.
- Small models write plans and edits less reliably than large ones. Keep a
  project on ask or accept edits until you trust the model you are using.

## License

GNU General Public License v3.0 or later. See [LICENSE](LICENSE).

Draggy is free software: you may use, study, change and share it. If you pass it
on, modified or not, you have to pass those same freedoms on with it and make
your source available under the same licence. There is no warranty, to the
extent the law allows.
