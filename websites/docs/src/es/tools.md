---
title: "Herramientas y capacidades"
description: "Búsqueda, el navegador, documentos, archivos y ejecución de código."
section: control
---

## Crear archivos

Word a partir de Markdown, PowerPoint con un título por diapositiva, Excel a partir de CSV o HTML, y PDF compuestos por el motor del navegador. Adjunta cualquiera de ellos de vuelta y Draggy los lee. Un PDF escaneado no tiene texto que extraer, y Draggy lo indica.

Las habilidades de Word, Excel, PowerPoint y PDF están siempre activas y no se pueden desactivar. El modelo carga la que corresponde antes de escribir el archivo.

Los tipos de archivo ejecutables y de script se rechazan al crear un documento o al abrir un archivo. Los scripts e instaladores se abren en su carpeta en lugar de ejecutarse.

## Ejecutar código

El agente ejecuta comandos de terminal y scripts en la carpeta del proyecto mediante el panel de terminal. En Windows se ejecutan en un [entorno aislado](doc:permissions#sandbox). Cada comando respeta el modo de permisos activo. Un comando largo pasa a una tarea en segundo plano, que el modelo puede leer, esperar o detener.

## La carpeta del chat

En Windows, cada conversación de Chat tiene su propia carpeta. Los archivos que crea el modelo se guardan allí, y sus comandos se ejecutan allí, siempre en el [entorno aislado](doc:permissions#sandbox) y sin red. Hay un Python incluido con Draggy, así que los scripts se ejecutan sin instalar nada. **Abrir la carpeta del chat** la abre en el Explorador, el panel Archivos muestra lo que contiene, y un archivo se abre en una pestaña de vista previa que puedes editar. La carpeta se elimina con el chat.

## Tus propios documentos

Apunta `Ajustes → Chat → Biblioteca` a una carpeta y su contenido se indexa en tu equipo, y luego se busca por significado.

## Desactivar herramientas

Una herramienta que no está disponible en este momento no aparece en la lista que ve el modelo. La búsqueda web se desactiva cuando la pones en **Desactivado**, y las herramientas web se van con ella.
