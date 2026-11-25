---
title: "Local engines"
description: "The Draggy engine, colibri and the local servers Draggy can use."
section: providers
---

## On this computer

The Draggy engine comes first, with the models you downloaded in `Settings → Models`. Below it are the local servers Draggy knows: [colibri](doc:glossary#colibri), Ollama, LM Studio, llama.cpp server, vLLM, SGLang, Jan, LocalAI, KoboldCpp, text-generation-webui, GPT4All, llamafile and Lemonade.

> [!NOTE]
> The colibri engine is for large mixture-of-experts models that do not fit in memory. It reads parts of the model from the drive as it goes, so it is slow.

Start the server, then press **Scan**. Draggy tries each one's usual port on this computer and lists the models it finds. For a server on another port or another machine, set its **Address** under **Advanced**. Some servers share a default port (colibri, vLLM and Lemonade on 8000; llama.cpp, LocalAI and llamafile on 8080), so a scan can list the wrong one.

## Local API

Draggy can also serve its own models to other programs. It is off by default, listens on `127.0.0.1:11500`, speaks the OpenAI `/v1/chat/completions` format, needs a key, and answers two replies at a time. It is under `Settings → Local API`.
