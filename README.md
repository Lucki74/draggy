<div align="center">

<img width="96" height="96" alt="Draggy" src="https://github.com/user-attachments/assets/746650c8-1251-443f-a323-43ed7dee89ec"/>

# Draggy


[![Website](https://img.shields.io/badge/Website-draggy.org-2b2b2b?style=flat)](https://draggy.org)
[![Download](https://img.shields.io/badge/Download-installers-2b2b2b?style=flat&logo=github&logoColor=white)](https://github.com/Lucki74/draggy/releases)
[![Wiki](https://img.shields.io/badge/Wiki-draggy.org%2Fwiki-2b2b2b?style=flat&logo=readthedocs&logoColor=white)](https://draggy.org/wiki)

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
![Hugging Face](https://img.shields.io/badge/Hugging%20Face-FFD21E?style=flat&logo=huggingface&logoColor=black)

</div>

> [!WARNING]
> **Install from official sources only.** Draggy comes from this repository, its
> [releases page](https://github.com/Lucki74/draggy/releases) and
> [draggy.org](https://draggy.org). Nothing is code signed, so a re-upload
> elsewhere is indistinguishable from a tampered build.

Draggy is a desktop AI assistant that talks, browses and works on your own
projects, all on models running on your own computer.

It runs models directly on your hardware via its built-in native GGUF engine
(powered by `llama.cpp`) with open weights from Hugging Face, so there is no
account, no API key, and no request leaving the machine unless you ask for one.
An Electron app, in React and TypeScript, for Windows, macOS and Linux.

**The wiki, at [draggy.org/wiki](https://draggy.org/wiki)**, is where the rest
lives: installing, requirements, every feature, troubleshooting, and how the
app is built, in the same twelve languages the app speaks. Start with
[Installation](https://draggy.org/wiki/installation), or
[Building and architecture](https://draggy.org/wiki/development) if you are here
to work on the code.

## Features

- **Chat with a local model.** Draggy picks a model that fits your graphics card,
  downloads it, and lets you swap it any time.
- **Stay quick on small models.** An efficient system prompt keeps 1B to 7B
  models responsive without cutting any instructions.
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
- **Extend it.** Forty-five MCP servers, the official registry and remote
  servers, plus 64 skills you start with / or leave to the model.
- **Talk to it.** A voice mode that knows when you have finished, answers out
  loud, and stops when you interrupt.
- **Plug other tools in.** An optional OpenAI-compatible API on 127.0.0.1, off
  by default and protected by a key.

## Upcoming

Many QoL improvements, small features and changes.
Suppport for ai providers other than draggy’s local engine.

## Installing and requirements

Pick your system on [draggy.org](https://draggy.org), or take the installer
straight from the [Releases page](https://github.com/Lucki74/draggy/releases).
Models are downloaded directly to your machine on first launch. See
[Installation](https://draggy.org/wiki/installation) for hardware requirements, the
code-signing warnings each system shows once, and how updates arrive.

## Building it yourself

```bash
npm install
```

```bash
npm run electron:dev
```

Vite and Electron together with hot reload. See
[Building and architecture](https://draggy.org/wiki/development) for how the
code is laid out,
[CONTRIBUTING.md](CONTRIBUTING.md) before sending a patch, and
[RELEASING.md](RELEASING.md) for how versions are published.

## Logging and diagnostics

Recorded in `app.log` (sanitized operational events) and `debug.log` (raw
diagnostic traces) in the application data folder. See
[Troubleshooting](https://draggy.org/wiki/troubleshooting) and
[Building and architecture](https://draggy.org/wiki/development) in the wiki.

## Known rough edges

- Noise cancelling in voice mode, the model will answer itself on speakers
- The quality of answers can vary a lot depending on the model choosen
- Generation speed depends heavily on the hardware of the user

## License

GNU General Public License v3.0 or later. See [LICENSE](LICENSE).
