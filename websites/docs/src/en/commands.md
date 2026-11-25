---
title: "Commands"
description: "What the model may run, in which shell, and what an allowance covers."
section: control
---

In Code the model runs commands in the project folder: git, gh, package managers, tests, builds. **Ask first** and **Accept edits** run read-only commands on their own and ask for the rest, with the full command shown first. **Turbo** and **YOLO** run them without asking. Plan only refuses commands. On Windows they run in a [sandbox](doc:permissions#sandbox).

## Which shell

The model can pick `pwsh`, `powershell`, `cmd`, `bash` or `sh`. If it picks none on Windows, Draggy uses `bash` when Git for Windows is installed, then PowerShell 7, then Windows PowerShell. `bash` comes from Git for Windows, not WSL. Inside the Windows [sandbox](doc:permissions#sandbox) only `cmd` starts, so sandboxed commands run in `cmd`, and the result says so when the model picked another shell.

## Background tool commands

When the model runs a command as a tool, it runs in the background with no interactive prompt. Prompts and pagers are turned off (`GIT_TERMINAL_PROMPT=0`, `PAGER=cat`, `GIT_PAGER=cat`, `NO_COLOR=1`). A command still running after two minutes moves to a background task; <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd> sends one there on demand.

## The terminal pane

For interactive commands, text editors, git operations or REPLs, press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd> (<kbd>⌘</kbd><kbd>Shift</kbd><kbd>T</kbd> on macOS) to toggle the terminal pane in the dock. It supports multiple tabs and custom shells (`pwsh`, `cmd`, `bash`, `sh`). Code blocks in chat also have a button to send commands straight to the terminal.

## Limits

- Two minutes by default, ten if the model asks for it
- Output over 30,000 characters is cut in the middle, keeping both ends
- Stopping the reply stops the command and everything it started

## Always allow is narrow

It remembers how a command starts, not the whole line. Allowing `npm test --watch` allows `npm test`; it does not allow `npm publish`. Anything that could run anything, such as `python` or `bash`, is remembered whole. Each command in a chain counts separately.

**A command is not undoable.** Draggy cannot see what it did, so a `git checkout .` is as final as it would be in your terminal.

Keyboard shortcuts are on their own page: [Keyboard shortcuts](doc:shortcuts).
