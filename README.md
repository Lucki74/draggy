<div align="center">

<img width="96" height="96" alt="Draggy" src="https://github.com/user-attachments/assets/746650c8-1251-443f-a323-43ed7dee89ec"/>

# Draggy

A local AI assistant and coding agent for Windows, macOS, and Linux. Free, open source, no account.

[![Website](https://img.shields.io/badge/Website-draggy.org-2b2b2b?style=flat&logo=vercel&logoColor=white)](https://draggy.org)
[![Download](https://img.shields.io/badge/Download-installers-2b2b2b?style=flat&logo=github&logoColor=white)](https://github.com/Lucki74/draggy/releases)
[![Release](https://img.shields.io/github/v/release/Lucki74/draggy?style=flat&label=release&color=2b2b2b)](https://github.com/Lucki74/draggy/releases/latest)
[![License](https://img.shields.io/github/license/Lucki74/draggy?style=flat&label=license&color=2b2b2b)](LICENSE)

<img width="880" alt="Draggy in Code mode, working on a sample project" src=".github/media/demo-code.gif"/>

<sub>Code mode on a sample project. Model waits are sped up 6 times.</sub>

</div>

> [!WARNING]
> **Install from official sources only.** Draggy comes from this repository, its
> [releases page](https://github.com/Lucki74/draggy/releases) and
> [draggy.org](https://draggy.org). Builds are not code signed, so third-party
> mirrors cannot be verified.

Draggy is a desktop assistant that talks, browses, and works in project folders,
running open models on your own computer.

It runs weights locally using an embedded `llama.cpp` engine with GGUF weights
from Hugging Face. There is no account and no telemetry. The app only touches
the network for things you ask for or switch on: model and engine downloads,
update checks, ad-block lists, and the price refresh behind the cost counters.
Automatic updates and the price refresh can be turned off in Settings. Available as an Electron application on Windows, a native
SwiftUI app on macOS, and a native GTK 4 app on Linux.

Compared with LM Studio, Jan or Ollama, the difference is the coding agent: it
reads, edits and runs commands in a project folder, shows every change as a diff
you can undo, and works under one of four permission modes. Large
Mixture-of-Experts models that do not fit in memory can still run from your drive.

Documentation lives on the wiki at [draggy.org/wiki](https://draggy.org/wiki):
installation details, hardware requirements, features, troubleshooting, and
architecture in English, French, Spanish, and Russian. Start with
[Installation](https://draggy.org/wiki/installation), or
[Building and architecture](https://draggy.org/wiki/development) to work on the code.

## Features

- Local GGUF models via llama.cpp.
- GPU acceleration: CUDA, Metal, Vulkan, ROCm.
- Coding agent with undoable diffs.
- Separate chat and code workspaces.
- Sandboxed browser and web search.
- Document generation.
- Semantic search across local folders.
- MCP servers, 572 built-in skills.
- Large MoE models from disk.
- Voice chat.
- Local image generation.
- OpenAI-compatible local server.
- External runtimes and cloud APIs.
- Cost counters for cloud usage.

## Installing and requirements

Installers for Windows (`.exe`), macOS (`.zip`), and Linux (`.deb`, `.rpm`) are available from [draggy.org](https://draggy.org) and the
[Releases page](https://github.com/Lucki74/draggy/releases/latest). On first launch,
Draggy suggests a model sized for your hardware and downloads it directly. See
[Installation](https://draggy.org/wiki/installation) for system requirements and platform setup details.

Image generation is optional and installed from Settings, under Models. The engine is a separate download of 17 to 900 MB depending on the build, and a model needs about 2 GB of video memory for Stable Diffusion 1.5 or 6 GB for Z-Image Turbo. With less, the weights stay in system memory.

Large models are managed from Settings, under Models, in the Large models panel. Draggy downloads colibri on demand, along with a small private Python runtime on Windows. Below 3 tokens per second it switches to slow mode: fewer tool rounds per turn, thinking off unless you turn it on, and a notification when a long answer is ready.

If Draggy is useful to you, a star on this repository helps other people find it.

## Building from source

[![Build](https://img.shields.io/github/actions/workflow/status/Lucki74/draggy/ci.yml?style=flat&label=build&logo=githubactions&logoColor=white)](https://github.com/Lucki74/draggy/actions/workflows/ci.yml)

![Electron](https://img.shields.io/badge/Electron-47848F?style=flat&logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat&logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-06B6D4?style=flat&logo=tailwindcss&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat&logo=sqlite&logoColor=white)

[![M8ven Score](https://m8ven.ai/badge/mcp/lucki74-draggy-1jbywd?v=cb3b9216ec8930f61be77210c1f8a9ce)](https://m8ven.ai/mcp/lucki74-draggy-1jbywd?s=readme)

```bash
cd win
npm install
npm run electron:dev
```

This starts Vite and Electron with hot reload on Windows.

### macOS (SwiftUI)
```bash
macos/scripts/build-core.sh
xcodegen generate
xcodebuild -scheme Draggy -configuration Debug
```

### Linux (GTK 4 & libadwaita)
```bash
cargo build --release -p draggy-linux
```

See [Building and architecture](https://draggy.org/wiki/development) for repository layout, [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines, and [RELEASING.md](RELEASING.md) for release workflows.

## Logging and diagnostics

Operational events write to `app.log` in the application data folder, while detailed traces write to `debug.log`. Prompts and text payloads are hashed for privacy. See [Troubleshooting](https://draggy.org/wiki/troubleshooting) for log locations across platforms.

## Known rough edges

- Output quality depends on the selected model size and quantization.
- Inference speed depends on available CPU and GPU memory bandwidth.
- Large models depend on drive speed. A hard disk or USB drive is usually too slow to be useful.

## License

Draggy is licensed under the [Apache License 2.0](LICENSE). You can use, modify, share, and distribute it, including in commercial projects, provided you retain the [NOTICE](NOTICE) attribution file.

### Trademarks

The license covers the code, not the Draggy name and logo. Provider logos shown in the app belong to their owners.
