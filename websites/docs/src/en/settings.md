---
title: "Settings"
description: "Every page of settings, and what each one changes."
section: customize
---

Three groups. **App** is Draggy as a whole, **Chat** and **Code** are each side's own. `/settings` opens the side you are on.

## App

| Page | Holds |
| --- | --- |
| General | Theme, text size, interface language (English, French, Spanish or Russian), and the speed and memory line under each reply |
| Models | Every installed model, the Hugging Face browser to add more, [context window](doc:glossary#context-window), [compaction limit](doc:glossary#compaction), and an Unload button, plus the image model (local or cloud) and image size |
| Providers | Servers on this computer, API keys, and plan sign-ins |
| Web search | Automatic, DuckDuckGo, Startpage, Brave Search, Brave Search API or SearXNG |
| Statistics | Replies, tokens, speed by model, tool usage, time per task, cost by model, budgets and editable prices. Local replies are priced at the OpenRouter rate of the model they are based on |
| Data | What is stored, and clearing history |
| Diagnostics | The log folder, and Export diagnostics for bug reports. The export replaces your home folder and user name |
| Extensions | Servers, remote servers and skills |
| Local API | An OpenAI-compatible API on this computer, off by default |

![Draggy's general settings: light or dark theme, text size, language, and the switch that shows speed and memory while it answers.](shot:app-settings-general)

## Chat and Code

Each has **Preferences**: its model, thinking mode, web access and custom instructions. Chat adds **Talk** and **Library**. Code adds **Permissions** and **Projects**, where each project keeps its permission mode, its `AGENTS.md` or `DRAGGY.md` and everything you have always-allowed.

The Library page indexes a folder of documents by meaning, so searches in Chat find the relevant passages. Indexing needs an embedding model. Draggy uses the one you chose, or picks one sized to your graphics card and downloads it the first time you add a folder.

Custom instructions are added to every conversation on that side.

## The local API

On `127.0.0.1:11500`, loopback only, Bearer key required, and requests carrying an `Origin` header are refused outright so a web page cannot reach it. It serves `/v1/models` and `/v1/chat/completions`.
