---
title: "Installation"
description: "What you need, getting past the first-run warning, and how updates arrive."
section: start
---

## What you need

A computer that can run [quantized](doc:glossary#quantization) language models. A graphics card is optional. It usually makes answers faster.

- Windows 10 or 11 (64-bit), macOS 14 Sonoma or newer (Apple silicon), or 64-bit Linux.
- Memory: at least 4 GB for Qwen 3.5 2B. Recommended: 16 GB for Qwen 3.5 9B.
- Free disk space of 1.5 times the model's size: about 0.8 GB for the smallest model, 9 GB for Qwen 3.5 9B.
- Graphics card: optional. Recommended: 8 GB of video memory with at least 10 GB of system memory. On macOS, unified memory is used automatically.

## Installing

Download the installer or package for your operating system from [the download page](site:download) or the [GitHub releases page](https://github.com/Lucki74/draggy/releases/latest):

> [!PLATFORMS]
> - Windows: Run the NSIS setup `.exe`. It installs for your user account only, into `%LOCALAPPDATA%\Programs\Draggy`. Windows SmartScreen may stop the installer, because the build is not signed with a developer certificate yet. Select More info, then choose Run anyway.
> - macOS: Download the Apple silicon zip, unzip it, right-click Draggy.app and select Open the first time.
> - Linux: Install the .deb package with your package manager or dpkg, or install the .rpm package with rpm or dnf.

Each release carries a `SHA256SUMS.txt` file, if you would rather check than trust.

## The first launch

Setup picks a model that fits your hardware and asks you to confirm it. The download starts when you continue past the model step, and it comes from Hugging Face. The first model is between about 0.5 GB and 240 GB, depending on the hardware.

When you send your first message, Draggy loads the model into memory. On later launches the model stays on disk until a prompt is sent, so opening the app is instant.

## Updates

Draggy checks for updates at every launch and every six hours after that. On Windows, the launch check runs in the small window Draggy shows while it starts. A found update downloads there with a progress line, installs, and Draggy restarts into the new version. **Start without updating** opens Draggy right away instead. If the check gets no answer within a few seconds, Draggy starts anyway. An update found later downloads in the background, and an **Update ready** notice offers **Install now** or **Maybe later**. Install now installs it quietly and restarts Draggy. There is no Updates setting, and updates never run from a development build.

On macOS, Draggy downloads the zip itself, checks its SHA-256 and swaps the app bundle after you quit. If the folder is not writable, it opens the release page instead. On Linux, Draggy downloads and verifies the package in the background, and the restart notice installs the .deb or .rpm with pkexec. Flatpak does nothing, and without pkexec Draggy opens the release page. Running from source, updates are disabled.

To remove Draggy, see [Uninstalling](doc:privacy#uninstalling) on the privacy page.
