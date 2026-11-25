---
title: "Security"
description: "What Draggy is allowed to do, what it refuses, and how to report a problem."
section: fix
---

This page gathers Draggy's limits and checks in one place. Each section links to the page that covers it in full. Some requests go out without you asking, such as update checks.

## Permission modes

Every tool call goes through one check before it runs. The mode you pick decides what asks first.

- **Plan only** reads the project and proposes changes. It changes nothing and runs no commands.
- **Ask first** asks before every change to your files and every command that is not read only.
- **Accept edits**, the default for new projects, edits files without asking. It asks before deletes and commands that are not read only.
- **Turbo** edits, deletes and moves files inside the project folder and runs commands in a sandbox, without asking. It asks before anything outside the folder.
- **YOLO** edits, deletes and runs commands across the whole computer, without asking and without a sandbox.

Reading never asks, in any mode. The full table is on the [Permissions](doc:permissions) page.

## Refused folders and files

Draggy refuses these whatever the mode.

- Folders such as `.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`, `.password-store`
- Files such as `.env`, `id_rsa`, `.pem`, `.pfx`, `.npmrc`, `.netrc`, `.git-credentials`, `credentials`
- Any single read over 2 MB

Executable and script file types are refused when a document is made or a file is opened. Names ending in a dot, a space or a stream suffix count too, and scripts and installers open in their folder instead of running. The full list is on the [Projects](doc:projects#what-is-refused-anyway) page, and [Tools and capabilities](doc:tools#making-files) covers documents.

## Running code

On Windows, commands run in a sandbox that reaches the project folder and little else. **Ask first** and **Accept edits** make the folder read only and cut the network; **Turbo** allows writes and the network. Environment variables whose names look like keys, tokens or passwords are removed before a sandboxed command starts. Where there is no sandbox, and in **YOLO**, commands run directly on your computer under your user account. Output over 30,000 characters is trimmed in the middle. The [Commands](doc:commands#limits) and [Permissions](doc:permissions) pages cover execution limits and approval rules.

## Remote servers and what they reach

An MCP server is a program that gives Draggy more tools. A local one is installed with npm into its own folder and runs directly on your computer, as you, with whatever credentials you typed in. Install scripts are refused and no shell is involved. No server is on by default.

A remote server runs somewhere else and is reached over HTTPS. Remote servers sign in with OAuth and PKCE. A local server also sends requests to the service it works with, such as GitHub. The [privacy page](doc:privacy#what-does-reach-the-network) lists where each kind of request goes, and [Extensions and skills](doc:extensions#the-catalogue) covers the servers.

## Logs and diagnostics

`app.log` holds events, with prompts and replies reduced to hashes and lengths and secrets scrubbed. `debug.log` records streaming output by length, not by text.

For a bug report, use `Settings → Diagnostics → Export diagnostics`. It replaces your home folder and user name, but read the file before you share it. The steps are under [Still stuck](doc:troubleshooting#still-stuck).

## Downloads

Download Draggy only from this site or the GitHub releases page. The Windows build is not signed with a developer certificate. Each release carries a `SHA256SUMS.txt` file, and Draggy checks every update it downloads. The first launch is covered on the [Installation](doc:installation) page.

## Reporting a vulnerability

Use GitHub's private reporting form, not a public issue. Say what you did, what happened, and what you expected. A rough proof of concept is welcome. Include the Draggy build number, and your operating system if it matters.

[Report a vulnerability on GitHub](https://github.com/Lucki74/draggy/security/advisories/new). The full policy is in [SECURITY.md](https://github.com/Lucki74/draggy/blob/main/SECURITY.md).
