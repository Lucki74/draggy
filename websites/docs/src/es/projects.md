---
title: "Proyectos"
description: "Dale una carpeta a Code. Ahí lee, edita y ejecuta comandos, y en ningún otro sitio."
section: use
---

Un proyecto es una carpeta en la que trabaja Code. Cada ruta se resuelve siguiendo los enlaces simbólicos y luego se comprueba contra esa carpeta, así que ni `..` ni un enlace que salga del árbol llegan a otro sitio.

![Un proyecto en Draggy: el árbol de archivos con sus cambios de git, la edición del test hecha por el modelo con el diff visible, npm test permitido y superado, y format.ts abierto junto a un plan terminado.](shot:app-project)

## Lo que se rechaza de todos modos

- Carpetas como `.ssh`, `.aws`, `.gnupg`, `.kube`
- Archivos como `.env`, `id_rsa`, `.pem`, `.npmrc`, `credentials`
- Tipos ejecutables y de script como `.exe`, `.bat`, `.ps1` y `.py`
- Cualquier cosa de más de 2 MB

## Todo cambio se puede deshacer

Un paso que cambió un archivo muestra una diferencia y un botón **Deshacer**. Los bytes anteriores se guardan en la carpeta propia de Draggy, así que deshacer funciona aunque la carpeta no sea un repositorio. Un archivo borrado va a la papelera del sistema.

## El lienzo

Haz clic en un archivo del árbol y se abre junto a la conversación: un archivo de código en modo de edición, o Markdown con un conmutador **Editar** y **Vista previa**. Las ediciones del modelo sobre el mismo archivo aparecen en él a medida que ocurren.

**Archivos** en la barra lateral muestra el mismo árbol a tamaño completo, con renombrar, mostrar y eliminar junto al editor.

## Git

En un repositorio, una franja bajo el árbol muestra la rama, lo que no está subido y lo que ha cambiado, con un botón **Diferencias** por archivo. El panel de diferencias incluye pestañas de **Historial** y **Ramas** para revisar confirmaciones y cambiar de rama local sin salir de la aplicación. El modelo lee a través de `git_status`, `git_diff`, `git_log` y `git_branches`, y puede preparar, quitar de la preparación y confirmar con `git_stage`, `git_unstage` y `git_commit`, que preguntan antes, igual que el cambio de rama. Las herramientas de lectura nunca confirman ni descargan, y funcionan con los filtros, las herramientas de diferencias externas y fsmonitor desactivados. Un comando que el modelo ejecute con `run_command` puede seguir ejecutando `git commit` o `git fetch` una vez lo apruebes.

## Resumen del trabajo

Cuando termina una tarea de varios pasos, Draggy muestra un bloque de resumen con el recuento de archivos creados, modificados y eliminados.

## Memoria del proyecto

Un `AGENTS.md` o `DRAGGY.md` en la raíz del proyecto se lee antes de cada respuesta. Escribe ahí lo que necesitaría saber alguien nuevo: cómo ejecutar las pruebas, qué no tocar, el estilo del proyecto. `/init` redacta uno.
