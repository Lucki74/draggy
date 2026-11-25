---
title: "Compilación y arquitectura"
description: "Ejecutar desde el código, cómo está organizado y las dos fronteras."
section: reference
---

## Ejecutar desde el código fuente

```bash
cd win
npm install
npm run tauri:dev
```

`tauri dev` prepara el sidecar `node.exe` y después inicia Vite en el puerto 5173 con recarga en caliente dentro de la ventana de Tauri. Si un proceso Vite antiguo ocupa el puerto, el siguiente inicio falla, así que deténlo primero.

```bash
npm run check
```

Comprobación de tipos, lint y las pruebas (`tsc -b`, `eslint .`, `vitest run`). La CI ejecuta el mismo comando, más `cargo fmt --check`, `cargo clippy` y `cargo test` en `win/src-tauri/`. `npm run tauri:build` prepara el sidecar y escribe el instalador NSIS en `src-tauri/target/release/bundle/nsis/`.

## Cómo está organizado

| Carpeta | Contiene |
| --- | --- |
| `core/` | Espacio de trabajo Rust compartido: motor, proveedores, herramientas, documentos, MCP y almacenamiento |
| `win/` | Aplicación Tauri 2 para Windows: `src-tauri/` para el shell en Rust y `src/` para la interfaz en React |
| `macos/` | Aplicación nativa en SwiftUI para macOS |
| `linux/` | Aplicación nativa en GTK 4 y libadwaita para Linux |
| `shared/` | Datos de precios, fixtures e iconos |

## Las dos fronteras

La primera son los archivos de capacidades de Tauri. `win/src-tauri/capabilities/main.json` enumera lo que puede llamar la ventana principal, y `browser-pane.json` no concede nada al panel del navegador. El renderizador solo llega al sistema de archivos, la red y la base de datos a través de los comandos en `win/src-tauri/src/ipc/`. Añadir un comando o un permiso es un acto deliberado, y `win/src-tauri/tests/capabilities.rs` comprueba los archivos.

La segunda es la Política de Seguridad de Contenido en `win/src-tauri/tauri.conf.json` (`app.security.csp`). Se aplica a la ventana de Draggy. `devCsp` se aplica solo con `tauri dev`. Las páginas que abre el panel del navegador no están bajo esta política, por eso se mantienen separadas de la ventana principal.

## Registros y diagnóstico

Draggy guarda dos registros rotatorios en la carpeta de datos de la aplicación (`logs/`):

- **`app.log`**: eventos del ciclo de vida, gestión de modelos y errores. Los mensajes y las respuestas se reducen a hashes y longitudes, y los secretos se eliminan.
- **`debug.log`**: un rastro más detallado. La salida en streaming se registra por longitud, no por texto.

Los registros rotan al llegar a 5 MiB y conservan tres archivos. Para verlos, abre `Ajustes → Diagnóstico → Abrir carpeta de registros`, o define `LOG_LEVEL=DEBUG` o `DEBUG_LOG_LEVEL=DEBUG` para el máximo detalle. Para un informe de error, usa `Ajustes → Diagnóstico → Exportar diagnóstico`.

## Motor de inferencia

Draggy ejecuta modelos locales con un motor integrado:

- **GGUF (llama.cpp)**: ejecuta archivos de modelo `.gguf` en un proceso hijo oculto `llama-server` en el puerto `11435`. Usa Metal en macOS. En Windows se elige la versión CUDA cuando se encuentra una tarjeta gráfica con memoria, y Vulkan en otro caso. Las tarjetas AMD usan la versión ROCm antes que Vulkan cuando hay una publicada. Solo se ejecuta un motor local a la vez.

Lo demás está en [CONTRIBUTING.md](https://github.com/Lucki74/draggy/blob/main/CONTRIBUTING.md), y [SECURITY.md](https://github.com/Lucki74/draggy/blob/main/SECURITY.md) explica cómo informar de una vulnerabilidad.

El sitio web y esta documentación están en el repositorio de la app, en [websites/www](https://github.com/Lucki74/draggy/tree/main/websites/www) y [websites/docs](https://github.com/Lucki74/draggy/tree/main/websites/docs).
