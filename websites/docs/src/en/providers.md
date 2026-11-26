---
title: "Providers"
description: "Servers you run, cloud providers with an API key, and plans you already pay for."
section: providers
---

Draggy runs models on this computer by itself. `Settings → Providers` is where you add more: a server you already run, a cloud provider with an API key, or a ChatGPT or Claude plan you already pay for. Each has its own group in that list.

## API keys

Press **Add provider** and pick one: OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, Mistral, Groq, Nebius, Novita, SambaNova, SiliconFlow, OpenRouter and others, or Custom for any OpenAI-compatible server. **Get a key** opens the provider's page for making one. Paste it into **API key** and press **Test**.

The key is encrypted before it is saved. Windows protects the encryption key with your user account; on macOS and Linux it lives in `secrets.key` in Draggy's data folder and only works on the same machine.

## Accounts

ChatGPT and Claude take a sign-in instead of a key. Draggy reaches each plan through that company's own tool or protocol: Codex for ChatGPT and Claude Code for Claude. The sign-in page opens in your browser. Draggy has no password field for these accounts.

Adding OpenAI or Anthropic asks which way you want: **Sign in with your plan** or **Use an API key**.

## What goes where

| Group | Where the model runs | What it costs |
| --- | --- | --- |
| On this computer | This computer | Nothing |
| API keys | The provider's servers | Each request, billed by the provider |
| Accounts | The company's servers | Your plan's limits |

What each one sends, and to whom, is on the [privacy page](doc:privacy).
