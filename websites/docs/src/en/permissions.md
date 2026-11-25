---
title: "Permissions"
description: "Five modes, from only proposing to working on its own."
section: control
---

Every tool call goes through one check before it runs, built-in tools and extension tools alike.

| Mode | Reads | Edits | Deletes | Commands |
| --- | --- | --- | --- | --- |
| Plan only | Yes | No | No | No |
| Ask first | Yes | Asks | Asks | Read-only ones run, others ask |
| Accept edits | Yes | Yes | Asks | Read-only ones run, others ask |
| Turbo | Yes | Yes, in the project | Yes, in the project | In the sandbox |
| [YOLO](doc:glossary#auto) | Yes | Yes | Yes | Yes |

![The permission mode menu open in a project, listing Plan only, Ask first, Accept edits, Turbo and YOLO, with Accept edits chosen.](shot:app-permission-modes)

> [!WARNING]
> **YOLO** has no sandbox and reaches the whole computer. Use it for machines you can restore.

**Accept edits** is the default. Every edit shows as a diff and can be undone. Chat, which has no project folder, runs without prompts. In Code, `Settings → Code → Preferences → New projects start in` sets the mode a new project begins with.

The browser pane asks before the agent acts on a site: **Allow once** or **Allow for this session**.

## The sandbox {#sandbox}

On Windows, commands run in a sandbox. In **Ask first** and **Accept edits** the project folder is read only for them and they have no network. In **Turbo** they can write in the project folder and use the network. Anything outside the project folder needs your yes first, and the model has to ask for it. **YOLO** has no sandbox and covers the whole computer. It asks you to confirm once when you switch to it, and a command can ask for admin rights, which brings up the Windows prompt.

Node tools such as npm, npx and vitest do not work inside the sandbox. When the model runs one, Draggy asks once, and after your yes it runs outside the sandbox. Setting up the sandbox can need administrator rights the first time. Windows asks for them once per computer, not at every launch.

## Reading never asks

In any mode, plan mode included: reading and listing files, searching them, git status and diffs, web search, your document library, loading a skill, writing the plan.

## The card

![A project in Accept edits, with a card asking for approval to run npm test and the buttons to answer it.](shot:app-settings-code)

| Button | Covers |
| --- | --- |
| Allow once | This call. The next one asks again. |
| Allow for this task | This kind of call for the rest of the reply. |
| Always allow here | Remembered for this project. For a command it covers the prefix, so allowing `npm run` covers every script. |
| Don't | Refused. The model carries on without it. |

`Settings → Code → Projects` lists everything you have allowed, each with **Remove**.
