---
title: "Installation"
description: "What you need, getting past the first-run warning, and how updates arrive."
section: start
---

## What you need

A computer that can run [quantized](doc:glossary#quantization) language models. A graphics card is optional. It usually makes answers faster.

- Windows 10 or 11 (64-bit), macOS 14 Sonoma or newer (Intel or Apple silicon), or 64-bit Linux with WebKitGTK 4.1, such as Ubuntu 24.04 or Fedora 40.
- Memory: at least 4 GB for Qwen 3.5 2B. Recommended: 16 GB for Qwen 3.5 9B.
- Free disk space of 1.5 times the model's size: about 0.8 GB for the smallest model, 9 GB for Qwen 3.5 9B.
- Graphics card: optional. Recommended: 8 GB of video memory with at least 10 GB of system memory. On macOS, unified memory is used automatically.

## Installing

Download the installer or package for your operating system from [the download page](site:download) or the [GitHub releases page](https://github.com/Lucki74/draggy/releases/latest):

> [!PLATFORMS]
> - Windows: Run `draggy_setup.exe`. It installs for your user account only, into `%LOCALAPPDATA%\Programs\Draggy`. Windows SmartScreen may stop the installer, because the build is not signed with a developer certificate yet. Select More info, then choose Run anyway.
> - macOS: Download the one universal `.zip`, which runs on Intel and Apple silicon Macs. Unzip it and move Draggy to Applications. The app is signed ad hoc and not notarized, so the first open needs System Settings → Privacy & Security → Open Anyway. Alternatively, run `xattr -dr com.apple.quarantine /Applications/Draggy.app` in Terminal.
> - Linux: Install the .deb with `sudo apt install ./file.deb`, or the .rpm with `sudo dnf install ./file.rpm`. For the AppImage, run `chmod +x` on it, then start it. The packages need WebKitGTK 4.1.

Each release carries a `SHA256SUMS.txt` file, if you would rather check than trust.

## The first launch

Setup picks a model that fits your hardware and asks you to confirm it. The download starts when you continue past the model step, and it comes from Hugging Face. The first model is between about 0.5 GB and 240 GB, depending on the hardware.

When you send your first message, Draggy loads the model into memory. On later launches the model stays on disk until a prompt is sent, so opening the app is instant.

## Updates

Windows, macOS and Linux all use the Tauri updater with a signed update feed. Draggy checks at launch and every six hours after that. An update found at launch installs in the small startup window, and Draggy restarts into the new version. **Start without updating** opens Draggy right away instead. If the check gets no answer within a few seconds, Draggy starts anyway. An update found later downloads in the background, and an **Update ready** notice offers **Install now** or **Maybe later**. Install now installs it quietly and restarts Draggy. There is no Updates setting. Builds run from source do not update.

To remove Draggy, see [Uninstalling](doc:privacy#uninstalling) on the privacy page.
