---
title: "Generación de imágenes"
description: "Dibuja imágenes en tu equipo: el comando, el modelo y el tamaño."
section: use
---

## Dibujar una imagen

Escribe `/image` seguido de lo que quieres, o pide una imagen en un chat. Draggy la dibuja en tu equipo con un motor de imágenes local, así que no se envía nada fuera. Un modelo de imagen en la nube envía el prompt a ese proveedor. En un [proyecto](doc:projects) el archivo se guarda en `assets/generated`. Fuera de un proyecto va a tus archivos creados.

## Conseguir un modelo de imagen

Abre **Ajustes → Modelos** y descarga un modelo de imagen como cualquier otro. Los modelos de imagen instalados muestran un icono de imagen junto al nombre, y la cuantización aparece en la línea de debajo. Un modelo que la app aún no puede ejecutar, como el de reconocimiento de voz o el de texto a voz, no se ofrece para descargar.

## Elegir el modelo y el tamaño

**Ajustes → Modelos → Generación de imágenes** tiene dos ajustes:

- **Modelo de imagen**: Automático, o uno de los modelos de imagen instalados, o un modelo de imagen en la nube de un proveedor que hayas conectado.
- **Resolución de imagen**: el tamaño con el que se dibuja cada imagen.

| Formato | Tamaños |
| --- | --- |
| 1:1 | 512 &times; 512, 768 &times; 768, 1024 &times; 1024 |
| 16:9 | 1024 &times; 576, 1344 &times; 768, 1792 &times; 1024 |
| 9:16 | 576 &times; 1024, 768 &times; 1344, 1024 &times; 1792 |

El modelo en uso lleva una etiqueta amarilla **Imágenes** en la lista de instalados. Los tamaños grandes tardan más y necesitan más memoria.

## Imágenes en las respuestas

Las respuestas muestran las imágenes generadas o encontradas en la web. Haz clic en una para abrirla en el visor de imágenes.
