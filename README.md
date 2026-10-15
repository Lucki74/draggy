<div align="center">

<img width="96" height="96" alt="Draggy" src="https://github.com/user-attachments/assets/746650c8-1251-443f-a323-43ed7dee89ec"/>

# Draggy


[![Website](https://img.shields.io/badge/Website-draggy.org-2b2b2b?style=flat&logo=vercel&logoColor=white)](https://draggy.org)
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
[![M8ven Score](https://m8ven.ai/badge/mcp/lucki74-draggy-1jbywd?v=cb3b9216ec8930f61be77210c1f8a9ce)](https://m8ven.ai/mcp/lucki74-draggy-1jbywd?s=readme)

</div>

> [!WARNING]
> **Install from official sources only.** Draggy comes from this repository, its
> [releases page](https://github.com/Lucki74/draggy/releases) and
> [draggy.org](https://draggy.org). Builds are not code signed, so third-party
> mirrors cannot be verified.

Draggy is a desktop assistant that talks, browses, and works in project folders,
running open models on your own computer.

It runs weights locally using an embedded `llama.cpp` engine with GGUF weights
from Hugging Face. There is no account, no telemetry, and no network traffic
unless you request it. Built with Electron, React, and TypeScript for Windows,
macOS, and Linux.

Documentation lives on the wiki at [draggy.org/wiki](https://draggy.org/wiki):
installation details, hardware requirements, features, troubleshooting, and
architecture in English, French, Spanish, and Chinese. Start with
[Installation](https://draggy.org/wiki/installation), or
[Building and architecture](https://draggy.org/wiki/development) to work on the code.

## Features

- Guided first-run setup selects your interface language, theme, and an initial model without starting downloads until confirmed.
- Run models locally through the built-in llama.cpp engine, with recommendations matched to your hardware.
- Compact system prompts keep smaller models (1B to 7B parameters) responsive.
- Sidebar modes keep general chat and project coding workflows in separate histories with independent models.
- Project tools read, edit, and run terminal commands within a folder, with undoable diff reviews.
- Four permission modes control tool autonomy: plan, ask, accept edits, and auto.
- Interactive task lists let you check off, reorder, or edit steps during execution.
- Web search and sandboxed browsing with ad blocking, plus document creation for docx, pptx, xlsx, and pdf formats.
- Local document indexing and semantic retrieval over folders you select.
- Extension support for 107 MCP servers, the official MCP registry, remote servers, and 66 built-in skills.
- Large Mixture-of-Experts models that do not fit in memory run through a second engine, colibri, which keeps the always-used weights in VRAM and RAM and reads experts from your drive. Expect roughly 0.3 to 3 tokens per second on a good NVMe drive.
- Voice mode with automatic turn detection, spoken responses, interruption handling, and an optional cloud voice.
- Replies stream in word by word with a short fade-in.
- Local image generation with `/image` or a tool call from the model. Stable Diffusion and Z-Image run on your graphics card, and a project gets the file saved in its folder.
- Optional local OpenAI-compatible API on 127.0.0.1, disabled by default and key protected.
- Optional third-party providers: connect local servers (Ollama, LM Studio, llama.cpp, vLLM, Lemonade) or hosted APIs (OpenAI, Mistral, DeepSeek, Groq, OpenRouter) with keys stored in the OS keystore.

## Installing and requirements

Download an installer from [draggy.org](https://draggy.org) or the
[Releases page](https://github.com/Lucki74/draggy/releases/latest):
[Windows](https://github.com/Lucki74/draggy/releases/latest/download/draggy_setup.exe),
macOS ([Apple Silicon](https://github.com/Lucki74/draggy/releases/latest/download/Draggy-arm64.dmg) or [Intel](https://github.com/Lucki74/draggy/releases/latest/download/Draggy-x64.dmg)),
and [Linux](https://github.com/Lucki74/draggy/releases/latest) as an AppImage or a `.deb`. On first launch,
Draggy suggests a model sized for your hardware and downloads it directly. See
[Installation](https://draggy.org/wiki/installation) for system requirements.

Image generation is optional and installed from Settings, under Models. The engine is a separate download of 17 to 900 MB depending on the build, and a model needs about 2 GB of video memory for Stable Diffusion 1.5 or 6 GB for Z-Image Turbo. With less, the weights stay in system memory.

### macOS: "Draggy" not opened

Because the macOS build is not notarized by Apple, the first launch shows
*Apple could not verify "Draggy" is free of malware*. Click **Done**, then either:

- Open **System Settings → Privacy & Security**, scroll down to *"Draggy" was blocked* and click **Open Anyway**, then enter your password; or
- Clear the quarantine attribute in Terminal after copying the app to Applications:

```bash
xattr -dr com.apple.quarantine /Applications/Draggy.app
```

This is required once per install. Because the app is not notarized, macOS installs do not update automatically: download the newer `.dmg` from the [Releases page](https://github.com/Lucki74/draggy/releases) when upgrading.

Large models are managed from Settings, under Models, in the Large models panel. Draggy downloads colibri on demand, along with a small private Python runtime on Windows. On macOS and Linux colibri uses the `python3` you have installed. Below 3 tokens per second it switches to slow mode: fewer tool rounds per turn, thinking off unless you turn it on, and a notification when a long answer is ready.

## Building from source

```bash
npm install
```

```bash
npm run electron:dev
```

This starts Vite and Electron with hot reload. See [Building and architecture](https://draggy.org/wiki/development) for repository layout, [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines, and [RELEASING.md](RELEASING.md) for release workflows.

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
