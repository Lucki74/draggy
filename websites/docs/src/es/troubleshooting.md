---
title: "Resolución de problemas"
description: "Problemas habituales y qué los arregla."
section: fix
---

## No pasa de la pantalla de inicio

En el primer inicio, Draggy descarga un modelo, de entre unos 0,5 GB y 240 GB según el equipo. El tiempo depende de tu conexión. Comprueba la conexión y que tengas libre en el disco 1,5 veces el tamaño del modelo.

## Las respuestas son muy lentas

Activa **Mostrar velocidad y memoria** en `Ajustes → General` y lee la cifra de la GPU. Una cifra baja de GPU significa que el modelo se desborda hacia el procesador: baja un tamaño en `Ajustes → Modelos`.

## El modelo describe una llamada a herramienta en lugar de hacerla

Si falla una llamada a herramienta, desactiva las herramientas que no necesites y vuelve a enviar el mensaje.

## Una extensión no arranca

| Mensaje | Significa |
| --- | --- |
| Aún no configurada | Hay un campo obligatorio vacío. Abre los campos de configuración. |
| No respondió a tiempo | El servidor no respondió a tiempo, y Draggy dejó de esperar. |
| No se encontró npm | Instala Node.js y reinicia Draggy. |

## El modo de voz no arranca

Si Draggy dice que no puede usar el micrófono, permítelo en los ajustes de privacidad de tu sistema. Si aparece **No hay voces de síntesis instaladas en este sistema**, añade una en los ajustes del sistema, o usa la voz **Natural**.

## Un comando falló por falta de acceso o de red

En Windows, los comandos se ejecutan en un [entorno aislado](doc:permissions#sandbox). En **Preguntar antes** y **Aceptar cambios**, la carpeta del proyecto queda allí en solo lectura y no hay red, así que algo como `npm install` falla. El modelo puede pedir ejecutar ese único comando fuera del entorno aislado, y tú respondes en una tarjeta. **Turbo** permite escribir y usar la red dentro del entorno aislado.

## Ha rechazado una ruta de archivo o una dirección local

El modelo solo puede acceder a la carpeta del proyecto, y solo puede obtener direcciones `http` y `https` públicas. Adjunta el archivo tú mismo, o abre la página en el navegador.

## Las actualizaciones nunca aparecen

Las actualizaciones solo funcionan en una versión instalada. Las compilaciones ejecutadas desde el código fuente no se actualizan.

## Sigue sin funcionar

`Ajustes → Diagnóstico → Abrir carpeta de registros` abre los registros. **`app.log`** contiene eventos, con los mensajes y los secretos reducidos. Para un informe de error, usa `Ajustes → Diagnóstico → Exportar diagnóstico`, que además reemplaza tu carpeta personal y tu nombre de usuario. Después, [abre una incidencia](https://github.com/Lucki74/draggy/issues/new?template=bug_report.yml) con el mensaje que viste.
