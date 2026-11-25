---
title: "Modo de voz"
description: "Háblale, y deja que responda en voz alta."
section: use
---

**Hablar** en la barra lateral de Chat es una conversación hablada, no un dictado. Escucha de forma continua, detecta cuándo has terminado, responde en voz alta y te deja interrumpir.

Usa auriculares, para que el micrófono no capte su propia voz.

![El modo de voz de Draggy, esperando para empezar a escuchar.](shot:app-talk)

## Teclas

| Tecla | Acción |
| --- | --- |
| `Esc` | Terminar la conversación |
| `Espacio` | Silenciar o activar el micrófono |

Usa los botones de la pantalla Hablar para saltar la respuesta o mostrar la transcripción.

## Voces

**Básica** usa las voces que proporciona tu sistema operativo. **Natural** es una voz neuronal que se ejecuta en tu equipo. Se descarga de Hugging Face la primera vez y habla inglés, francés y español. La velocidad tiene cuatro pasos: 0,9x, 1x, 1,1x y 1,25x. En ruso se usa la voz del sistema.

**Nube** envía el texto de la respuesta, y no tu voz, a OpenAI o Google Gemini, para que la voz de ese proveedor pueda leerla. Aceptas cada proveedor antes. Si una voz en la nube falla a mitad de respuesta, una voz local termina la respuesta. En los ajustes de Hablar eliges el modelo y el nombre de la voz en la nube.

La escucha se ejecuta en tu equipo, con Whisper base, o con Moonshine base para inglés. Tu audio no se sube.

## Cuando algo sale mal

- **Se interrumpe solo.** Su propia voz llega al micrófono. Usa auriculares.
- **Va lento.** La pantalla Hablar muestra el tiempo de respuesta en milisegundos. Si se mantiene alto, prueba con un modelo de voz más pequeño.
- **«Detección básica».** El detector de voz neuronal no se cargó, y se usa uno más sencillo.
