---
title: "Motores locales"
description: "El motor de Draggy, colibri y los servidores locales que Draggy puede usar."
section: providers
---

## En este ordenador

El motor de Draggy va primero, con los modelos que descargaste en `Ajustes → Modelos`. Debajo están los servidores locales que Draggy conoce: [colibri](doc:glossary#colibri), Ollama, LM Studio, llama.cpp server, vLLM, SGLang, Jan, LocalAI, KoboldCpp, text-generation-webui, GPT4All, llamafile y Lemonade.

> [!NOTE]
> El motor colibri sirve para modelos grandes de mezcla de expertos que no caben en memoria. Lee partes del modelo desde el disco sobre la marcha, así que es lento.

Arranca el servidor y pulsa **Buscar**. Draggy prueba el puerto habitual de cada uno en este ordenador y muestra los modelos que encuentra. Para un servidor en otro puerto o en otra máquina, indica su **Dirección** en **Avanzado**. Algunos servidores comparten un puerto predeterminado (colibri, vLLM y Lemonade en el 8000; llama.cpp, LocalAI y llamafile en el 8080), así que un escaneo puede listar el equivocado.

## API local

Draggy también puede servir sus propios modelos a otros programas. Está desactivada por defecto, escucha en `127.0.0.1:11500`, habla el formato `/v1/chat/completions` de OpenAI, necesita una clave y atiende dos respuestas a la vez. Está en `Ajustes → API local`.
