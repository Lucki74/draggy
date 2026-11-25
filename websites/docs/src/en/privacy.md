---
title: "Privacy and data"
description: "What leaves the machine, what is stored, and where."
section: fix
---

Draggy has no account and sends no telemetry. The requests it makes, such as update checks and model downloads, reach the hosts listed below. Unless you add a cloud provider, the model answering you is a process on your own computer, reached over `127.0.0.1`.

## What does reach the network

| What | Where |
| --- | --- |
| Model downloads | Hugging Face (huggingface.co). Engines come from GitHub |
| Web searches | The provider you pick. Automatic tries several in turn. |
| Pages read or opened | That site |
| Result icons | Each result's own site, not a favicon service |
| Ad blocker lists | GitHub (uBlock Origin, EasyList and AdGuard lists) and oisd.nl (OISD), in the background while ad blocking is on |
| Cost display prices and exchange rates | GitHub (LiteLLM price list), OpenRouter (model list) and api.frankfurter.dev. GET requests only, with no chat data |
| Speech models | Hugging Face, first use only |
| Update checks and downloads | GitHub releases |
| Connection check at first setup | Hugging Face, one request, when no model is installed |
| Extensions you switch on | npm, then that service |
| A cloud provider you add | That provider |
| A cloud image model you pick | That provider |
| A cloud voice you agree to | That provider, the assistant's reply text only |
| Signing in with ChatGPT or Claude | OpenAI or Anthropic, through that provider's tool or protocol |
| Claude Code, when a Claude sign-in starts | Anthropic's API, one start-up request |
| The list of providers | draggy.org, at most once a day, once a cloud provider is turned on |

The table lists the requests Draggy makes. Ad-block lists stay on until you switch ad blocking off in the browser pane. Draggy also makes one connection check at first setup, when no model is installed. To send fewer requests, set web search to **Off**, leave extensions off, add no cloud provider, cloud voice or cloud image model. Update checks have no switch. Model downloads and first-use speech models still need the network.

## Where everything is kept

| System | Folder |
| --- | --- |
| Windows | `%APPDATA%\Draggy` |
| macOS | `~/Library/Application Support/Draggy` |
| Linux | `~/.config/Draggy` |

Inside: `draggy.db` for conversations and settings, `library.db` for the document index, `secrets.bin` for provider keys and extension credentials encrypted by your OS keystore, the sign-in folders for ChatGPT and Claude, and folders for created files, chat folders (`chats`, on Windows), code runs, speech models and installed servers.

Data from Electron-era builds moves into this folder on first launch, including the older `localai` folder. Copy the folder to back it up or move machines, with Draggy closed. Delete it to reset. Credentials in `secrets.bin` are tied to this machine and this user, so type those in again elsewhere.

## Uninstalling

> [!NOTE]
> Uninstalling leaves that folder in place, so a reinstall gets your conversations back. Delete the folder to remove everything Draggy keeps, including the ChatGPT and Claude sign-in folders.
