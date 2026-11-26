---
title: "Permisos"
description: "Cinco modos, desde solo proponer hasta trabajar por su cuenta."
section: control
---

Cada llamada a una herramienta pasa por una comprobación antes de ejecutarse, tanto las herramientas integradas como las de extensiones.

| Modo | Lee | Edita | Borra | Comandos |
| --- | --- | --- | --- | --- |
| Solo planificar | Sí | No | No | No |
| Preguntar antes | Sí | Pregunta | Pregunta | Las de solo lectura se ejecutan, el resto pregunta |
| Aceptar cambios | Sí | Sí | Pregunta | Las de solo lectura se ejecutan, el resto pregunta |
| Turbo | Sí | Sí, en el proyecto | Sí, en el proyecto | En el entorno aislado |
| [YOLO](doc:glossary#auto) | Sí | Sí | Sí | Sí |

![El menú de modos de permiso abierto en un proyecto, con Solo planificar, Preguntar antes, Aceptar cambios, Turbo y YOLO, y Aceptar cambios elegido.](shot:app-permission-modes)

> [!WARNING]
> **YOLO** no tiene entorno aislado y alcanza todo el equipo. Úsalo en equipos que puedas restaurar.

**Aceptar cambios** es el valor por defecto. Cada edición se muestra como una diferencia y se puede deshacer. Chat, que no tiene carpeta de proyecto, funciona sin avisos. En Code, `Ajustes → Code → Preferencias → Los proyectos nuevos empiezan en` fija el modo con el que empieza un proyecto nuevo.

El panel del navegador pide permiso antes de que el agente actúe en un sitio: **Permitir una vez** o **Permitir durante esta sesión**.

## El entorno aislado {#sandbox}

En Windows, los comandos se ejecutan en un entorno aislado. En **Preguntar antes** y **Aceptar cambios**, la carpeta del proyecto es de solo lectura para ellos y no tienen red. En **Turbo** pueden escribir en la carpeta del proyecto y usar la red. Todo lo que quede fuera de la carpeta del proyecto necesita tu sí antes, y el modelo tiene que pedirlo. **YOLO** no tiene entorno aislado y abarca todo el equipo. Pide una confirmación al activarlo, y un comando puede pedir permisos de administrador, lo que abre el aviso de Windows.

Las herramientas de Node como npm, npx y vitest no funcionan dentro del entorno aislado. Cuando el modelo ejecuta una, Draggy pregunta una vez y, tras tu sí, se ejecuta fuera del entorno aislado. Preparar el entorno aislado puede necesitar permisos de administrador la primera vez. Windows los pide una vez por equipo, no en cada inicio.

## Leer nunca pregunta

En cualquier modo, incluido el de planificar: leer y listar archivos, buscarlos, el estado de git y las diferencias, la búsqueda web, tu biblioteca de documentos, cargar una habilidad, escribir el plan.

## La tarjeta de permisos

![Un proyecto en Aceptar cambios, con una tarjeta que pide aprobación para ejecutar npm test y los botones para responder.](shot:app-settings-code)

| Botón | Alcance |
| --- | --- |
| Permitir una vez | Esta llamada. La siguiente vuelve a preguntar. |
| Permitir en esta tarea | Este tipo de llamada hasta el final de la respuesta. |
| Permitir siempre aquí | Recordado para este proyecto. En un comando abarca el prefijo, así que permitir `npm run` abarca todos los scripts. |
| No | Rechazado. El modelo sigue sin ello. |

`Ajustes → Code → Proyectos` enumera todo lo que has permitido, cada entrada con **Eliminar**.

`Ajustes → Code → Permisos` guarda reglas que valen en todos los modos. Elige **Permitir siempre** o **No permitir nunca**, un tipo (comando, ruta, herramienta o sitio web), la regla y dónde se aplica: todos los proyectos o uno. Una regla No permitir nunca gana a cualquier modo y a cualquier Permitir siempre, así que un comando bloqueado sigue bloqueado incluso en auto.
