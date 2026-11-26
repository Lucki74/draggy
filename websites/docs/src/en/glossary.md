---
title: "Glossary"
description: "What the terms in this wiki mean, and the page that explains each one."
section: reference
---

A term links to its entry here the first time it appears in the wiki.

### Engine {#engine}

The program that loads a model and writes its replies. The Draggy engine runs GGUF models on your computer. See [Providers](doc:local-engines#on-this-computer).

### colibri {#colibri}

The engine Draggy uses for large mixture-of-experts models that do not fit in memory. It reads parts of the model from the drive as it goes, so it is slow. See [Providers](doc:local-engines#on-this-computer).

### Provider {#provider}

A source of models in Draggy: the built-in engine, a server on this computer, a cloud provider with an API key, or a ChatGPT or Claude plan. See [Providers](doc:providers).

### GGUF {#gguf}

The file format of the models the Draggy engine runs. A model is one `.gguf` file, or several for very large models. See [Choosing a model](doc:models#browsing-and-downloading).

### Quantization {#quantization}

A way of storing a model's numbers in fewer bits, which makes the file smaller. `Settings → Models` lists each variant of a model with its file size. See [Choosing a model](doc:models#browsing-and-downloading).

### Context window {#context-window}

The amount of text, counted in tokens, that a model can hold at once. The context wheel in the composer shows how full it is. See [Chat and Code](doc:chat-and-code#long-conversations).

### Compaction {#compaction}

Folding the older part of a long conversation into a summary, so the conversation can carry on. By default it happens when a quarter of the context window is left free, or 50,000 tokens on a large window, and never on a window of 8k or less. Paid cloud models fold by 64,000 tokens unless you set a limit. See [Chat and Code](doc:chat-and-code#long-conversations).

### MCP server {#mcp-server}

A program that gives Draggy more tools, through the Model Context Protocol. `Settings → Extensions` lists them. See [Extensions and skills](doc:extensions#what-a-server-is).

### Skill {#skill}

A folder with a `SKILL.md` file that teaches the model one kind of job. The model reads a skill only when a request fits it, and you can start one by typing `/` and its name. See [Extensions and skills](doc:extensions#skills).

### Embedding model {#embedding-model}

A model that turns text into vectors, which the Library uses to search documents by meaning. It cannot hold a conversation. See [Choosing a model](doc:models).

### Talk {#talk}

Draggy's spoken conversation mode, in the Chat sidebar. It listens, works out when you have finished, answers out loud, and lets you cut in. See [Voice mode](doc:voice).

### Sandbox {#sandbox}

A restricted space that commands run in. On Windows it sees the project folder and little else, and has no network in **Ask first** and **Accept edits**. **YOLO** has none. See [Permissions](doc:permissions#sandbox).

### Turbo (permission mode) {#turbo}

The permission mode that edits, deletes and moves files in the project folder and runs commands in a sandbox, without asking. It asks before anything outside the folder. See [Permissions](doc:permissions).

### YOLO (permission mode) {#auto}

The permission mode that edits files and runs commands across the whole computer without asking and without a sandbox. Keep it for machines you can restore. Web search has an Automatic setting too, and it does not change permissions. See [Permissions](doc:permissions).
