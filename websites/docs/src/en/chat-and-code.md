---
title: "Chat and Code"
description: "Two sides, each with its own history, model and settings."
section: use
---

<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd> switches between them.

Nothing set on one side reaches the other. Code works inside one folder and shows every change as a diff.

|  | Chat | Code |
| --- | --- | --- |
| Conversations | Chat history | Sessions, one list per project |
| Files | What it wrote for you | The project folder |
| Model | Its own | Its own, or the same as Chat |
| Tools | Web, browser, documents | Files, commands, code, git, plans |
| Voice | Talk | Not here |

## The composer

| Control | Does |
| --- | --- |
| Off / Low / Medium / High / Max | How hard the model thinks. Off turns reasoning off rather than asking for less. |
| On / Off | Whether it may use the web. |
| Model name | The model answering. <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd> opens the model menu. |
| Context wheel | How full the window is. Click for the breakdown. |

Type `/` for slash commands: `/new`, `/model`, `/compact`, `/settings`, `/web`, `/think`, `/voice`, `/files`, `/image`, or any enabled [skill](doc:glossary#skill). `/permissions`, `/memory` and `/init` work in Code only.

Images pasted or attached to the composer show preview cards with quick removal before sending.

## Interactive questions

When the model needs choices or clarification, it displays interactive question cards in the chat. Questions support single choice, multiple choice, or free-form text input.

A question session bar tracks progress through multi-part questionnaires with next, submit, and skip controls.
## Watching tool calls

Each tool call shows up while the model is still writing it, with its name and its arguments as key and value rows. A long file write streams into a small box that follows the newest line. When a call finishes, a muted line says what came of it, such as the number of results or lines. Read-only tool calls run in parallel. When the reply ends, the work of the turn folds into one summary row, and a click opens it again. The steps stay with the chat when you reopen it.

## Queueing messages

While a reply is generating, type a follow-up and press <kbd>Enter</kbd> to steer: the note goes into the running reply. Press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to queue it for the next turn, or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd> to interrupt and send now. Queued messages are saved and persist if you restart the app. A steer note can be taken back with **Take back and edit** before the next turn, then changed.

## Exporting chats

The sidebar session menu lets you export a conversation to Markdown (`.md`) or standalone HTML (`.html`). The export includes reasoning steps, tool activity, code diffs and generation metrics.

## When a conversation gets long {#long-conversations}

When a reply reaches the context limit and the model has room, Draggy automatically expands the window to the next bucket and continues generating. If the conversation reaches 60% of what the model can hold, Draggy folds the older part of the conversation into a summary, and the conversation carries on. For paid cloud models, that point is capped at 64,000 tokens unless you set a limit.

`/compact` does it now. `/compact-limit 20k` moves the point, and `auto` puts it back.
