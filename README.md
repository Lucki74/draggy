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

# UPCOMING 2.0 version on the [v2 branch](https://github.com/Lucki74/draggy/tree/v2). 
Draggy is a desktop AI assistant that talks, browses and works with your files,
all on models running on your own computer.

It drives a local [Ollama](https://ollama.com) instance, so there is no account,
no API key, and no request leaving the machine unless you ask for one. An
Electron app, in React and TypeScript, for Windows, macOS and Linux.


## What it does

- **Chat with a local model.** Draggy sizes a model to your graphics card on
  first launch and downloads it. Three answering modes, swappable models.
- **Use tools.** Web search, reading a page, and driving a real browser session.
  It writes Word, PowerPoint, Excel, PDF, code and text files, reads them back
  when you attach one, and runs short Python and JavaScript in a sandbox.
- **Browse without ads.** Links open in a browser window inside the app, with
  uBlock Origin's filter lists on Ghostery's engine, YouTube adverts and
  anti-adblock walls included.
- **Search your own documents.** Point it at a folder and it indexes the
  contents locally, on meaning and keywords at once.
- **Extend it.** Thirty-four Model Context Protocol servers in a catalogue,
  none on by default.
- **Talk to it.** Continuous voice mode that works out when you have finished a
  sentence, answers out loud, and stops when you cut in.
- **Export a conversation.** Any chat to Markdown, from the history list.

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
990 tests in a few seconds. See [CONTRIBUTING.md](CONTRIBUTING.md) before
sending a patch, and [RELEASING.md](RELEASING.md) for how versions are cut.

## How it is laid out

```
electron/     main process: windows, IPC, SQLite, search, the embedded
              browser, code execution, MCP servers, updates
src/          the React app
src/agent/    the streaming tool-calling loop, and conversation compaction
src/chat/     the message list and the rules for what can be attached
src/settings/ the settings panels
src/tools/    tool definitions and the registry they live in
src/voice/    capture, voice activity detection, turn-taking, speech
src/__tests__ everything that can be tested without a GPU
```

Two boundaries matter. `electron/preload.cjs` is the security one: the renderer
has no Node access and reaches the filesystem, network and database only through
what is exposed there. The second is the session split, with Draggy's own window
under a strict Content Security Policy and every external page on a separate
partition with no policy of ours imposed on it.

Quitting stops everything Draggy started: browser windows, extension servers, a
code run still going, and Ollama if Draggy was the one that started it.

[Architecture](https://github.com/Lucki74/draggy/wiki/Architecture) has the rest.

## Privacy

The only things that reach the internet are model downloads, searches you or the
model trigger, pages the browser opens, the speech models on first use, the ad
blocker's filter lists, site icons for search results, the update check, and any
extension you switch on. Everything else is local. There is no telemetry and
nowhere for it to go.

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
  the summary.

## License

GNU General Public License v3.0 or later. See [LICENSE](LICENSE).

Draggy is free software: you may use, study, change and share it. If you pass it
on, modified or not, you have to pass those same freedoms on with it and make
your source available under the same licence. There is no warranty, to the
extent the law allows.
