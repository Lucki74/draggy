---
title: "Chat y Code"
description: "Dos lados, cada uno con su historial, su modelo y sus ajustes."
section: use
---

<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd> cambia entre uno y otro.

Lo que ajustas en un lado no llega al otro. Code trabaja dentro de una sola carpeta y muestra cada cambio como una diferencia.

|  | Chat | Código |
| --- | --- | --- |
| Conversaciones | Historial de chat | Sesiones, una lista por proyecto |
| Archivos | Lo que escribió para ti | La carpeta del proyecto |
| Modelo | El suyo | El suyo, o el mismo que Chat |
| Herramientas | Web, navegador, documentos | Archivos, comandos, código, git, planes |
| Voz | Hablar | No disponible aquí |

## La zona de escritura

| Control | Qué hace |
| --- | --- |
| Desactivado / Bajo / Medio / Alto / Máximo | Cuánto piensa el modelo. Desactivado apaga el razonamiento en lugar de pedir menos. |
| Activado / Desactivado | Si puede buscar en la web. |
| Nombre del modelo | El modelo que responde. <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd> abre el menú de modelos. |
| Rueda de contexto | Cuánto se ha llenado la ventana. Haz clic para ver el desglose. |

Escribe `/` para los comandos: `/new`, `/model`, `/compact`, `/settings`, `/web`, `/think`, `/voice`, `/files`, `/image`, o cualquier [habilidad](doc:glossary#skill) activada. `/permissions`, `/memory` e `/init` funcionan solo en Code.

Las imágenes pegadas o adjuntas al compositor muestran tarjetas de vista previa con eliminación rápida antes del envío.

## Preguntas interactivas

Cuando el modelo necesita opciones o aclaraciones, muestra tarjetas de preguntas interactivas en el chat con opción única, múltiple o respuesta libre.

Una barra de sesión sigue el progreso con controles de avanzar, enviar y omitir.

## Ver las llamadas a herramientas

Cada llamada a una herramienta aparece mientras el modelo aún la escribe, con su nombre y sus argumentos en filas de clave y valor. La escritura de un archivo largo se muestra en una caja pequeña que sigue la última línea. Cuando una llamada termina, una línea tenue dice qué resultó, por ejemplo el número de resultados o de líneas. Las llamadas a herramientas de solo lectura se ejecutan en paralelo. Al terminar la respuesta, el trabajo del turno se pliega en una fila de resumen, y un clic la vuelve a abrir. Los pasos se quedan en el chat cuando lo vuelves a abrir.

## Cola de mensajes

Mientras se genera una respuesta, escribe un seguimiento y pulsa <kbd>Enter</kbd> para añadirlo a la respuesta en curso. Pulsa <kbd>Ctrl</kbd>+<kbd>Enter</kbd> para ponerlo en cola para el siguiente turno, o <kbd>Ctrl</kbd>+<kbd>Mayús</kbd>+<kbd>Enter</kbd> para interrumpir y enviar al instante. Los mensajes en cola se guardan y se mantienen si reinicias la aplicación. Una nota de guía se puede retirar con **Retirar y editar** antes del siguiente turno, y luego cambiarla.

## Exportar conversaciones

El menú de sesión en la barra lateral te permite exportar una conversación a Markdown (`.md`) o a HTML independiente (`.html`). La exportación incluye los pasos de razonamiento, la actividad de las herramientas, las diferencias de código y las métricas de generación.

## Cuando una conversación se alarga {#long-conversations}

Cuando una respuesta alcanza el límite de contexto y el modelo tiene espacio, Draggy amplía automáticamente la ventana al siguiente tramo y sigue generando. Al 70 % de lo que el modelo puede retener, Draggy resume la parte antigua de la conversación, y la conversación sigue. En los modelos de pago en la nube, ese punto se limita a 64 000 tokens, salvo que pongas un límite.

`/compact` lo hace ahora. `/compact-limit 20k` mueve el punto, y `auto` lo devuelve a su sitio.
