---
title: "Inicio rápido"
description: "Instala Draggy, deja que la configuración elija un modelo y envía tu primer mensaje."
section: start
---

## 1. Instalar Draggy

Descarga el instalador para tu sistema desde [la página de descarga](site:download).

> [!PLATFORMS]
> - Windows: Windows puede mostrar un aviso de SmartScreen en el primer arranque, porque la compilación aún no está firmada con un certificado de desarrollador. Selecciona Más información y luego Ejecutar de todas formas.
> - macOS: Descomprime la descarga para Apple silicon, haz clic derecho en Draggy.app y selecciona Abrir la primera vez.
> - Linux: Instala el paquete .deb con tu gestor de paquetes o dpkg, o el paquete .rpm con rpm o dnf.

[Instalación](doc:installation) tiene todos los pasos.

## 2. Dejar que la configuración elija un modelo

En el primer arranque, la configuración elige un modelo que encaja con tu hardware y te pide confirmarlo. La descarga empieza al continuar. Viene de Hugging Face, y el primer modelo pesa entre 0,5 GB y 240 GB aproximadamente según tu hardware. [Elegir un modelo](doc:models) explica la elección y lista los modelos para cada tamaño de tarjeta gráfica.

## 3. Enviar un mensaje

Escribe en el cuadro de texto del lado Chat y envía. Draggy carga el modelo en memoria al enviar el primer mensaje, así que la primera respuesta tarda más que las siguientes. La respuesta se genera en este ordenador.

## 4. Abrir un proyecto en Code

Para trabajar con archivos, pasa a Code con <kbd>Ctrl</kbd>+<kbd>Mayús</kbd>+<kbd>X</kbd> y dale una carpeta de [proyecto](doc:projects). En el modo por defecto pregunta antes de ejecutar un comando, y cada edición se puede deshacer. [Permisos](doc:permissions) describe los modos.

## Siguientes pasos

- [Chat y Code](doc:chat-and-code) cubre los dos lados de la aplicación.
- [Proveedores](doc:providers) muestra cómo añadir ChatGPT, Claude o un servidor local.
- [Solución de problemas](doc:troubleshooting) ayuda cuando un modelo no carga o una descarga se detiene.
