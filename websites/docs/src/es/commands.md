---
title: "Comandos"
description: "Qué puede ejecutar el modelo, en qué shell y qué cubre un permiso."
section: control
---

En Code, el modelo ejecuta comandos en la carpeta del proyecto: git, gh, gestores de paquetes, pruebas, compilaciones. **Preguntar antes** y **Aceptar cambios** ejecutan solos los comandos de solo lectura y preguntan por el resto, con el comando completo mostrado antes. **Turbo** y **YOLO** los ejecutan sin preguntar. **Solo planificar** rechaza los comandos. En Windows se ejecutan en un [entorno aislado](doc:permissions#sandbox).

## Qué shell

El modelo puede elegir `pwsh`, `powershell`, `cmd`, `bash` o `sh`. Si no elige ninguno en Windows, Draggy usa `bash` cuando Git para Windows está instalado, luego PowerShell 7 y después Windows PowerShell. `bash` viene de Git para Windows, no de WSL. Dentro del [entorno aislado](doc:permissions#sandbox) de Windows solo arranca `cmd`, así que allí los comandos se ejecutan en `cmd`, y el resultado lo indica cuando el modelo eligió otro shell.

## Comandos de herramientas en segundo plano

Cuando el modelo ejecuta un comando como herramienta, se ejecuta en segundo plano sin indicador interactivo. Las peticiones y los paginadores están desactivados (`GIT_TERMINAL_PROMPT=0`, `PAGER=cat`, `GIT_PAGER=cat`, `NO_COLOR=1`). Un comando que siga en marcha después de dos minutos pasa a una tarea en segundo plano; <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd> lo envía allí cuando quieras.

## El panel de terminal

Para comandos interactivos, editores de texto, operaciones de git o REPL, pulsa <kbd>Ctrl</kbd>+<kbd>Mayús</kbd>+<kbd>T</kbd> (<kbd>⌘</kbd><kbd>Mayús</kbd><kbd>T</kbd> en macOS) para abrir el panel de terminal en el dock. Admite varias pestañas y shells personalizados (`pwsh`, `cmd`, `bash`, `sh`). Los bloques de código en el chat también tienen un botón para enviar comandos directamente a la terminal.

## Límites

- Dos minutos por defecto, diez si el modelo lo pide
- La salida de más de 30 000 caracteres se corta por el medio, conservando los dos extremos
- Detener la respuesta detiene el comando y todo lo que haya iniciado

## Permitir siempre es estrecho

Recuerda cómo empieza un comando, no la línea completa. Permitir `npm test --watch` permite `npm test`; no permite `npm publish`. Lo que pueda ejecutar cualquier cosa, como `python` o `bash`, se recuerda completo. Cada comando de una cadena cuenta por separado.

**Un comando no se puede deshacer.** Draggy no ve lo que hizo, así que un `git checkout .` es tan definitivo como en tu terminal.

Los atajos de teclado tienen su propia página: [Atajos de teclado](doc:shortcuts).
