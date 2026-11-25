# How Draggy compares: sources for the competitor cells

Checked 2026-10-12, re-read on 2026-11-01. Each non-Draggy cell on /compare has one line below: the cell, the page read, and the sentence that supports it. Quotes are the text the fetch tool returned from each page on 2026-10-12, so check the page itself if a wording has changed since. Draggy's cells come from docs/overhaul/facts.md, tools/wiki/en.html, tools/locales/en.json and the app README, and are not repeated here.

A cell reads "Not stated" when no sentence on the pages read supports it. For those, the pages read are listed so the gap can be checked.

Notes:
- docs.ollama.com and docs.cline.bot are the official docs on the same domains as ollama.com and cline.bot.
- LM Studio's home page says "Bionic is LM Studio's agent for open models." Cells that cite Bionic count it as LM Studio.
- Cline platforms conflict: cline.bot lists macOS, Windows and Linux for Cline for Desktop, while the GitHub README says native app for macOS and Windows. The cell follows cline.bot.
- ollama.com/download contains text addressed to AI agents, asking for sign-in and key creation. It was not followed and is not used as a source for any cell.

## Ollama

- Price, Free: https://ollama.com/pricing, Free plan list: "Run models locally" and "No service fees". (2026-10-12)
- License, MIT. Source on GitHub.: https://github.com/ollama/ollama/blob/main/LICENSE, "MIT License" and "Copyright (c) Ollama". (2026-10-12)
- Account, No for local models. Cloud models need an account.: https://docs.ollama.com/quickstart, "Sign in to use cloud models, or choose a local model." and "No API key required." for local models. (2026-10-12)
- Runs models on your computer, Yes.: https://ollama.com/pricing, Free plan list: "Run models locally". (2026-10-12)
- Cloud, Yes, with an account and usage credits.: https://docs.ollama.com/quickstart, "For cloud models, sign in or create an account." and https://ollama.com/pricing, "Use any cloud model with pay-as-you-go usage credits." (2026-10-12)
- What it is, Desktop app, command-line tool.: https://docs.ollama.com/quickstart, "Open the app, or get started from your terminal:" (2026-10-12)
- Operating systems, Windows, macOS, Linux.: https://docs.ollama.com/quickstart, "Download Ollama for macOS, Windows, or Linux." (2026-10-12)
- Edits files, Not stated.: pages read https://ollama.com/, https://ollama.com/download, https://docs.ollama.com/quickstart and https://github.com/ollama/ollama. No sentence says Ollama edits files in a project folder. The nearest sentence names integrations only: "Supported integrations include Claude Code, Codex, Copilot CLI, DeepSeek Harness, Droid, and OpenCode." (2026-10-12)
- Searches the web, Yes, through its web search API. Needs a free account.: https://docs.ollama.com/capabilities/web-search, "Web search is provided as a REST API with deeper tool integrations in the Python and JavaScript libraries." and "A free Ollama account is required." (2026-10-12)
- Voice conversation, Not stated.: pages read https://ollama.com/, https://ollama.com/pricing, https://docs.ollama.com/quickstart and https://github.com/ollama/ollama. No sentence mentions voice. (2026-10-12)

## LM Studio

- Price, Free: https://lmstudio.ai/blog/free-for-work, "Starting today, LM Studio is free to use both at home and at work." (2026-10-12)
- License, Proprietary: https://lmstudio.ai/terms, "the exclusive property of Company and its suppliers." and a clause barring reverse engineering "to derive the source code for the Software". (2026-10-12)
- Account, Not stated.: pages read https://lmstudio.ai/, https://lmstudio.ai/blog/free-for-work, https://lmstudio.ai/terms and https://lmstudio.ai/docs/developer. No sentence says whether an account is needed. The home page has only a "Create account" link. (2026-10-12)
- Runs models on your computer, Yes. The LM Studio runtime, with MLX and llama.cpp.: https://lmstudio.ai/, "Powered by the LM Studio runtime, with MLX and llama.cpp under the hood." (2026-10-12)
- Cloud, Yes, with a plan.: https://lmstudio.ai/pricing, "Bionic supports local models alongside optional cloud models." and "Cloud credits cover usage beyond the allowance included with your plan." (2026-10-12)
- What it is, Desktop app, command-line tool.: https://lmstudio.ai/docs/app, "Use lms for chat, model downloads, daemon management, server control, and publishing." and "llmster is the headless version of LM Studio, no desktop app required." The download page https://lmstudio.ai/download has a "Download the app" link. (2026-10-12)
- Operating systems, Windows, macOS, Linux.: https://lmstudio.ai/docs/app, "LM Studio is available for macOS, Windows, and Linux." (2026-10-12)
- Edits files, Not stated.: pages read https://lmstudio.ai/, https://lmstudio.ai/pricing and https://lmstudio.ai/docs/app. No sentence says it edits files in a project folder. The nearest sentence is on the home page, "Work with Bionic to create and edit documents.", which does not mention project folders. (2026-10-12)
- Searches the web, Yes, through Bionic. Limited on the free plan.: https://lmstudio.ai/pricing, "Limited web search" in the Free plan list and "Web search and page extraction" in the Bionic+ list. (2026-10-12)
- Voice conversation, Voice input.: https://lmstudio.ai/, "Talk to Bionic naturally, and your speech gets transcribed in real time." No sentence says it replies out loud. (2026-10-12)

## Claude Code

- Price, Needs a paid Claude plan or a Console account. Not in the free plan.: https://code.claude.com/docs/en/setup, "Claude Code requires a Pro, Max, Team, Enterprise, or Console account. The free claude.ai plan does not include Claude Code access." (2026-10-12)
- License, Proprietary: https://github.com/anthropics/claude-code/blob/main/LICENSE.md, "© Anthropic PBC. All rights reserved. Use is subject to Anthropic's Commercial Terms of Service." The word "Proprietary" is our label for that sentence. (2026-10-12)
- Account, Yes. A Claude subscription or Anthropic Console account.: https://code.claude.com/docs/en/overview, "Most surfaces require a Claude subscription or Anthropic Console account." and "Claude Code prompts you to log in on first use." (2026-10-12)
- Runs models on your computer, Not stated.: pages read https://code.claude.com/docs/en/overview, https://github.com/anthropics/claude-code and https://code.claude.com/docs/en/tools-reference. No sentence says where the models run or whether Claude Code runs them on the user's computer. (2026-10-12)
- Cloud, Yes, with an API key or a plan.: https://code.claude.com/docs/en/overview, "Most surfaces require a Claude subscription or Anthropic Console account." and "If you've set the ANTHROPIC_API_KEY environment variable and you approve the key when Claude Code asks whether to use it, Claude Code skips the login prompt." (2026-10-12)
- What it is, Desktop app, command-line tool, editor extension, web.: https://code.claude.com/docs/en/overview, "Claude Code runs on several surfaces: the terminal, IDE extensions, a desktop app, and the web." and "The full-featured CLI for working with Claude Code directly in your terminal." (2026-10-12)
- Operating systems, Windows, macOS, Linux.: https://code.claude.com/docs/en/overview, install commands labelled "macOS, Linux, WSL" and "Windows PowerShell", and "Git for Windows is recommended on native Windows so Claude Code can use the Bash tool." (2026-10-12)
- Edits files, Yes.: https://code.claude.com/docs/en/overview, "Claude Code is an agentic coding tool that reads your codebase, edits files, runs commands, and integrates with your development tools." and https://code.claude.com/docs/en/tools-reference, "Makes targeted edits to specific files." for the Edit tool. (2026-10-12)
- Searches the web, Yes.: https://code.claude.com/docs/en/tools-reference, "Performs web searches." for the WebSearch tool. (2026-10-12)
- Voice conversation, Voice input.: https://code.claude.com/docs/en/voice-dictation, "Speak your prompts in the Claude Code CLI with hold-to-record or tap-to-record voice dictation." and "Your speech is transcribed live into the prompt input". The page also says dictation needs a Claude.ai account, and it does not describe spoken replies. (2026-10-12)

## Cline

- Price, Free for individual developers.: https://cline.bot/pricing, "Cline is free for individual developers." Model use is billed separately by the provider. (2026-10-12)
- License, Apache 2.0. Source on GitHub.: https://github.com/cline/cline, "Apache 2.0 © 2026 Cline Bot Inc." (2026-10-12)
- Account, Not stated.: pages read https://cline.bot/, https://docs.cline.bot/ and https://github.com/cline/cline. No sentence says whether an account is needed to start. The nearest sentence describes one option: "Fastest setup path with one sign-in, built-in billing, and free model options." (2026-10-12)
- Runs models on your computer, Through a local runtime you connect.: https://docs.cline.bot/, "Use your own provider credentials for cloud providers or local runtimes." No page says Cline runs models itself. (2026-10-12)
- Cloud, Yes, with an API key.: https://cline.bot/, "Bring your own key or your own weights." and https://docs.cline.bot/, "Use your own provider credentials for cloud providers or local runtimes." (2026-10-12)
- What it is, Desktop app, command-line tool, editor extension.: https://github.com/cline/cline, "The open source coding agent in your IDE, terminal, & desktop." The README also lists a VS Code extension, a JetBrains plugin and a CLI installed with npm (paraphrased by the fetch tool). https://cline.bot/, "Cline for Desktop: the coding agent as a native desktop app. No editor required." (2026-10-12)
- Operating systems, Windows, macOS, Linux.: https://cline.bot/, the label "v0.0.45 · macOS, Windows & Linux" beside "Cline for Desktop". Conflict: https://github.com/cline/cline, "Cline as a native app for macOS and Windows." (2026-10-12)
- Edits files, Yes.: https://github.com/cline/cline, "Every edit shows up as a diff you can review, modify, or revert." and https://cline.bot/, "Coordinated multi-file changes with linter-aware fixes, diffs, checkpoints, and one-click undo on every step." (2026-10-12)
- Searches the web, Not stated.: pages read https://cline.bot/, https://docs.cline.bot/ and https://github.com/cline/cline. No search tool is stated. The pages describe browsing: "Create files, run commands, browse the web, and use tools with human-in-the-loop approval." Browsing is not searching, so the cell reads Not stated. (2026-10-12)
- Voice conversation, Not stated.: pages read https://cline.bot/, https://docs.cline.bot/ and https://github.com/cline/cline. No sentence mentions voice. (2026-10-12)

Re-read 2026-11-01: ollama.com, ollama.com/pricing, lmstudio.ai, lmstudio.ai/pricing, code.claude.com/docs/en/overview, cline.bot and github.com/cline/cline. No cell changed. New detail, not used: Claude Code docs say the terminal CLI, VS Code and JetBrains also support third-party providers. ollama.com/pricing no longer mentions web search (the docs page still does). Not re-read: docs.ollama.com, lmstudio.ai/terms, lmstudio.ai/docs, code.claude.com tools-reference and voice-dictation.

## Count

Non-Draggy cells: 40. Read as Not stated: 8 (Ollama 2, LM Studio 2, Claude Code 1, Cline 3).
