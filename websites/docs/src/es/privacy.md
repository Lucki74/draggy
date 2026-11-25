---
title: "Privacidad y datos"
description: "Qué sale de la máquina, qué se guarda y dónde."
section: fix
---

Draggy no tiene cuenta y no envía telemetría. Las solicitudes que hace, como las comprobaciones de actualizaciones y las descargas de modelos, llegan a los hosts listados abajo. Salvo que añadas un proveedor en la nube, el modelo que te responde es un proceso en tu propio ordenador, al que se llega por `127.0.0.1`.

## Qué llega a la red

| Qué | Dónde |
| --- | --- |
| Descargas de modelos | Hugging Face (huggingface.co). Los motores vienen de GitHub |
| Búsquedas web | El proveedor que elijas. En automático se prueban varios, uno tras otro. |
| Páginas leídas o abiertas | Ese sitio |
| Iconos de resultados | El sitio de cada resultado, no un servicio de favicons |
| Listas del bloqueador de anuncios | GitHub (listas de uBlock Origin, EasyList y AdGuard) y oisd.nl (OISD), en segundo plano mientras el bloqueo está activado |
| Precios para la visualización de costes y tipos de cambio | GitHub (lista de precios de LiteLLM), OpenRouter (lista de modelos) y api.frankfurter.dev. Solo solicitudes GET, sin datos del chat |
| Modelos de voz | Hugging Face, solo en el primer uso |
| Comprobación y descarga de actualizaciones | Versiones en GitHub |
| Comprobación de conexión en la primera configuración | Hugging Face, una solicitud, cuando no hay ningún modelo instalado |
| Extensiones que activas | npm, y luego ese servicio |
| Un proveedor en la nube que añades | Ese proveedor |
| Un modelo de imagen en la nube que eliges | Ese proveedor |
| Una voz en la nube que aceptas | Ese proveedor, solo el texto de la respuesta del asistente |
| Iniciar sesión con ChatGPT o Claude | OpenAI o Anthropic, a través de la herramienta o protocolo del proveedor |
| Claude Code, al iniciar una sesión de Claude | La API de Anthropic, una solicitud de inicio |
| La lista de proveedores | draggy.org, como máximo una vez al día, una vez activado un proveedor en la nube |

La tabla enumera las solicitudes de Draggy. Los listados del bloqueador de anuncios siguen activos hasta que lo desactives en el panel del navegador. Draggy también hace una comprobación de conexión en la primera configuración, cuando no hay ningún modelo instalado. Para enviar menos solicitudes, pon la búsqueda web en **Desactivado**, deja las extensiones apagadas, no añadas proveedores, voces ni modelos de imagen en la nube. Las comprobaciones de actualizaciones no tienen interruptor. Las descargas de modelos y las voces de la primera vez siguen necesitando la red.

## Dónde se guarda todo

| Sistema | Carpeta |
| --- | --- |
| Windows | `%APPDATA%\Draggy` |
| macOS | `~/Library/Application Support/Draggy` |
| Linux | `$XDG_DATA_HOME/Draggy`, o `~/.local/share/Draggy` si esa variable no está definida |

Dentro: `draggy.db` para conversaciones y ajustes, `library.db` para el índice de documentos, `secrets.bin` para las claves de proveedores y las credenciales de extensiones cifradas con el llavero de tu sistema, las carpetas de inicio de sesión de ChatGPT y Claude, y carpetas para los archivos creados, las carpetas de chat (`chats`, en Windows), las ejecuciones de código, los modelos de voz y los servidores instalados.

Los datos de las compilaciones de la era de Electron se trasladan a esta carpeta en el primer inicio, incluida la carpeta antigua `localai`. Copia la carpeta para hacer una copia de seguridad o cambiar de equipo, con Draggy cerrado. Bórrala para empezar de cero. Las credenciales de `secrets.bin` están ligadas a este equipo y a este usuario, así que vuelve a introducirlas en otro sitio.

## Desinstalar

> [!NOTE]
> Quitar la aplicación deja esa carpeta, para que al reinstalar recuperes tus conversaciones. Borra la carpeta para eliminar todo lo que guarda Draggy, incluidas las carpetas de inicio de sesión de ChatGPT y Claude.
