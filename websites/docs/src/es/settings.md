---
title: "Ajustes"
description: "Cada página de ajustes, y qué cambia cada una."
section: customize
---

Tres grupos. **Aplicación** es Draggy en conjunto; **Chat** y **Code** son cada lado por separado. `/settings` abre el lado en el que estás.

## Aplicación

| Página | Contiene |
| --- | --- |
| General | Tema, tamaño del texto, idioma de la interfaz (inglés, francés, español o ruso), y la línea de velocidad y memoria bajo cada respuesta |
| Modelos | Cada modelo instalado, el explorador de Hugging Face para añadir más, [la ventana de contexto](doc:glossary#context-window), [el límite de compactación](doc:glossary#compaction) y un botón Descargar, además del modelo (local o en la nube) y el tamaño de las imágenes |
| Proveedores | Servidores en este ordenador, claves de API y planes con inicio de sesión |
| Búsqueda web | Automática, DuckDuckGo, Startpage, Brave Search, API de Brave Search o SearXNG |
| Estadísticas | Respuestas, tokens, velocidad por modelo, uso de herramientas, tiempo por tarea, coste por modelo, presupuestos y precios editables. Las respuestas locales se valoran a la tarifa de OpenRouter del modelo en el que se basan |
| Datos | Lo que se almacena, y borrar el historial |
| Diagnóstico | La carpeta de registros, y Exportar diagnóstico para informes de errores. La exportación reemplaza tu carpeta personal y tu nombre de usuario |
| Extensiones | Servidores, servidores remotos y habilidades |
| API local | Una API compatible con OpenAI en este ordenador, desactivada por defecto |

![Los ajustes generales de Draggy: tema claro u oscuro, tamaño del texto, idioma, y el interruptor que muestra la velocidad y la memoria mientras responde.](shot:app-settings-general)

## Chat y Code

Cada uno tiene sus **Preferencias**: su modelo, modo de pensamiento, acceso a la web e instrucciones personalizadas. Chat añade **Hablar** y **Biblioteca**. Code añade **Permisos** y **Proyectos**, donde cada proyecto guarda su modo de permisos, su `AGENTS.md` o `DRAGGY.md` y todo lo que hayas permitido siempre.

La página Biblioteca indexa una carpeta de documentos por significado, para que las búsquedas en Chat encuentren los fragmentos relevantes. La indexación necesita un modelo de embedding. Draggy usa el que hayas elegido, o elige uno adaptado a tu tarjeta gráfica, y lo descarga la primera vez que añades una carpeta.

Las instrucciones personalizadas se añaden a cada conversación de ese lado.

## La API local

En `127.0.0.1:11500`, solo bucle local, se requiere clave Bearer, y las solicitudes con cabecera `Origin` se rechazan directamente para que una página web no pueda llegar a ella. Sirve `/v1/models` y `/v1/chat/completions`.
