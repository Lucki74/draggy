---
title: "Quickstart"
description: "Install Draggy, let setup pick a model and send your first message."
section: start
---

## 1. Install Draggy

Download the installer for your system from [the download page](site:download).

> [!PLATFORMS]
> - Windows: Windows may show a SmartScreen warning on the first run, because the build is not signed with a developer certificate yet. Select More info, then choose Run anyway.
> - macOS: Unzip the universal download and move Draggy to Applications. The first open needs System Settings → Privacy & Security → Open Anyway.
> - Linux: Install the .deb with `sudo apt install ./file.deb`, or the .rpm with `sudo dnf install ./file.rpm`. The AppImage runs after `chmod +x`.

[Installation](doc:installation) has the full steps.

## 2. Let setup pick a model

On the first launch, setup picks a model that fits your hardware and asks you to confirm it. The download starts when you continue. It comes from Hugging Face, and the first model is between about 0.5 GB and 240 GB depending on your hardware. [Choosing a model](doc:models) explains the pick and lists the models for each graphics card size.

## 3. Send a message

Write in the composer on the Chat side and send it. Draggy loads the model into memory when you send the first message, so the first reply takes longer than the ones after it. The reply is made on this computer.

## 4. Open a project in Code

To work on files, switch to Code with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd> and give it a [project](doc:projects) folder. In the default mode it asks before it runs a command, and every edit can be undone. [Permissions](doc:permissions) describes the modes.

## Where to go next

- [Chat and Code](doc:chat-and-code) covers both sides of the app.
- [Providers](doc:providers) shows how to add ChatGPT, Claude or a local server.
- [Troubleshooting](doc:troubleshooting) helps when a model will not load or a download stalls.
