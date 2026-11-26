---
title: "Proveedores"
description: "Los servidores que ejecutas, los proveedores en la nube con clave de API y los planes que ya pagas."
section: providers
---

Draggy ejecuta modelos en este ordenador por sí mismo. `Ajustes → Proveedores` sirve para añadir más: un servidor que ya tengas en marcha, un proveedor en la nube con clave de API, o un plan de ChatGPT o Claude que ya pagas. Cada uno tiene su propio grupo en esa lista.

## Claves de API

Pulsa **Añadir proveedor** y elige uno: OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, Mistral, Groq, Nebius, Novita, SambaNova, SiliconFlow, OpenRouter y otros, o Custom para cualquier servidor compatible con OpenAI. **Conseguir una clave** abre la página del proveedor para crear una. Pégala en **Clave de API** y pulsa **Probar**.

La clave se cifra antes de guardarse. Windows protege la clave de cifrado con tu cuenta de usuario; en macOS y Linux está en `secrets.key`, en la carpeta de datos de Draggy, y solo funciona en el mismo equipo.

## Cuentas

ChatGPT y Claude se conectan con un inicio de sesión en lugar de una clave. Draggy llega a cada plan a través de la herramienta o protocolo de la empresa: Codex para ChatGPT y Claude Code para Claude. La página de inicio de sesión se abre en tu navegador. Draggy no tiene ningún campo de contraseña para estas cuentas.

Al añadir OpenAI o Anthropic te pregunta qué camino quieres: **Iniciar sesión con tu plan** o **Usar una clave de API**.

## Dónde va cada cosa

| Grupo | Dónde se ejecuta el modelo | Qué cuesta |
| --- | --- | --- |
| En este ordenador | Este ordenador | Nada |
| Claves de API | Los servidores del proveedor | Cada solicitud, facturada por el proveedor |
| Cuentas | Los servidores de la empresa | Los límites de tu plan |

Lo que envía cada uno, y a quién, está en la [página de privacidad](doc:privacy).
