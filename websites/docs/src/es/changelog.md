---
title: "Registro de cambios"
description: "Dónde están las notas de versión y cómo se numeran las versiones."
section: reference
---

Cada compilación de Draggy es una release en GitHub, con sus notas e instaladores: [versiones de Draggy](https://github.com/Lucki74/draggy/releases).

## Compilación 18

- Las claves de API se guardan en cualquier Mac y sistema Linux. Las cifra un archivo de clave ligado al equipo, sin llavero del sistema.
- En macOS la ventana usa los botones del sistema, cerrarla deja Draggy en el Dock y los servidores MCP ya no añaden un segundo icono al Dock.
- Los chats se exportan en PDF, y la exportación a PDF funciona en macOS.
- Los ajustes tienen **Buscar actualizaciones** y un **Shell predeterminado** para los terminales nuevos, que si no abren tu shell de inicio de sesión.
- Los servidores MCP se instalan con el npm que trae Draggy.

### Correcciones

- La barra de direcciones y los botones atrás y adelante del navegador funcionan en macOS y Linux.
- Las carpetas que no son repositorios Git ya no llenan el registro de errores de Git.

## Compilación 17

- Draggy funciona con la misma app Tauri en Windows, macOS y Linux.
- macOS vuelve como una sola app universal para Mac con Apple silicon e Intel con macOS 14 o posterior. Está firmada ad hoc, así que la primera vez haz clic derecho y elige **Abrir**.
- Linux recibe una AppImage junto a los paquetes .deb y .rpm.
- Cada sistema se actualiza desde su propio canal firmado. En Windows, la compilación 16 no puede actualizarse sola: instala la compilación 17 a mano una vez.
- Las herramientas de vídeo en macOS y Linux usan un ffmpeg incluido.
- Los modelos de un proveedor añadido tienen un interruptor y empiezan activados.
- La ventana de contexto se lee de las listas de modelos de llama.cpp y vLLM.

### Correcciones

- Añadir un proveedor Personalizado (compatible con OpenAI) vuelve a funcionar.
- El espacio libre en disco es correcto en macOS.
- El chat sigue visible cuando se ensancha el panel lateral.
- Las búsquedas web ya no vuelven vacías cuando un buscador muestra una comprobación antibots.

## Compilación 16

- Las compilaciones de macOS estaban en pausa; esta salió para Windows y Linux.
- Los errores de descarga dicen qué hacer ante un disco lleno, una carpeta sin permiso de escritura, una suma de verificación incorrecta o una dirección bloqueada.
- Las habilidades activadas más allá de la 40 siguen pudiendo usarse.

### Correcciones

- Las descargas de modelos en Windows ya no fallan con "URL refused by outbound security policy".
- Cerrar Draggy o un cierre inesperado ya no deja llama-server ni procesos de shell en marcha.
- Las herramientas MCP que solo dicen ser de lectura preguntan antes de ejecutarse, y las descargas web se detienen en 16 MiB.
- Cuando cambian varios archivos a la vez, se detectan todos, y los lienzos abiertos ya no se quedan desactualizados.
- Intro con un editor de métodos de entrada, Esc en menús y al renombrar, y Reintentar en la pantalla de error vuelven a funcionar.

## Compilación 15

### Correcciones

- La IA vuelve a poder leer los vídeos adjuntos.

## Compilación 14

- Se pueden adjuntar vídeos a un chat.
- La API local habla los formatos de herramientas y mensajes de Codex, Claude Code, Cline y Open WebUI.

### Correcciones

- Las respuestas en chats con sesión iniciada en una cuenta ya no salen vacías.
- Las llamadas a herramientas y los mensajes de seguimiento en chats de ChatGPT funcionan.
- Las llamadas a la herramienta de navegador aparecen como completadas en lugar de fallidas.

## Build 13

- Draggy arranca en una pequeña ventana que busca una actualización, la descarga y se reinicia con la nueva versión. **Iniciar sin actualizar** la omite.
- Tras una actualización, la ventana de arranque muestra la nueva versión.

### Correcciones

- Se instalan todas las habilidades de la biblioteca integrada.
- Los mensajes largos en alfabetos no latinos ya no se toman por binarios.

### Seguridad

- Los comandos ejecutados como administrador ya no pasan por una ventana oculta de PowerShell.

## Compilación 12

- Las respuestas muestran imágenes generadas o encontradas en la web. Haz clic para abrir el visor.
- Los modelos de imagen en la nube de un proveedor conectado aparecen en Ajustes, junto a los modelos locales.
- El modelo de voz en la nube y el nombre de la voz se eligen en los ajustes de Hablar.
- Las estadísticas valoran las respuestas locales a la tarifa de OpenRouter del modelo, con desglose por modelo.
- Una nota de guía se puede retirar y editar.
- La investigación marca las citas que no están en la página y enumera las fuentes de cada ejecución.

### Correcciones

- El modelo predeterminado en la nube se abre al iniciar.
- llama.cpp ya no reutiliza un contexto obsoleto.
- La búsqueda web durante la investigación espera al enfriamiento.
- El panel del navegador se abre cuando el agente visita una página.
- Se corrige el estado «Cargando modelo de voz».

### Seguridad

- Se bloquean las direcciones privadas resueltas por DNS.
- Se rechazan más tipos de ejecutables.
- Los scripts e instaladores se abren en su carpeta en lugar de ejecutarse.

## Compilación 11

Versión 3.0.11, etiqueta `b-11` en GitHub.

- La aplicación de Windows funciona con Tauri en lugar de Electron. Tus ajustes, chats y claves guardadas se conservan, y la instalación anterior se elimina tras la actualización.
- En Windows, los comandos del agente se ejecutan en un entorno aislado que ve la carpeta del proyecto y las herramientas de tu PATH.
- npm, npx, vitest y otras herramientas de Node preguntan una vez y luego se ejecutan fuera del entorno aislado, donde funcionan.
- **Permitir siempre aquí** abarca un prefijo de comando, así que permitir `npm run` abarca todos los scripts.
- El panel del navegador bloquea más anuncios, incluidos los filtros scriptlet, y su ventana separada tiene su propia barra.
- Los controles de la ventana se dibujan en la barra de título de la aplicación.

### Correcciones

- Los comandos de Node ya no se quedan colgados en el entorno aislado ni se reintentan durante decenas de pasos.
- El aviso de administrador del entorno aislado aparece una vez por equipo, no en cada inicio.
- Los comandos en el entorno aislado pueden listar las carpetas por encima del proyecto, así que PowerShell y `dir` funcionan ahí.

## Compilación 10

Versión 3.0.10, etiqueta `b-10` en GitHub.

- Draggy se actualiza solo en Windows, macOS y Linux. Comprueba en cada inicio, con un límite de 4 segundos, y cada seis horas. Instala una actualización encontrada en una pequeña ventana «Updating Draggy» y se reinicia. Un resultado tardío se instala al cerrar o desde un aviso de reinicio que puedes descartar. Ya no existe un ajuste de actualizaciones.
- macOS descarga él mismo el zip, comprueba su SHA-256 y cambia el paquete de la aplicación al salir de Draggy. Si la carpeta no se puede escribir, abre la página de la versión.
- Linux descarga y verifica la actualización en segundo plano, y luego instala el .deb o el .rpm con pkexec desde el aviso de reinicio. Flatpak no hace nada. Sin pkexec, abre la página de la versión.
- Las versiones incluyen un archivo SHA256SUMS.txt.
- Cada llamada a herramienta se muestra en vivo en el chat: su nombre y sus argumentos aparecen mientras el modelo los escribe, y sus pasos se quedan con el chat al reabrirlo.
- Las llamadas a herramientas de solo lectura se ejecutan en paralelo.
- Deep research, Fact check, News brief y Trend scan leen fuentes, las guardan en una biblioteca de investigación y las citan en la respuesta.
- Los turnos del asistente se han rediseñado: el trabajo de un turno se pliega en un único resumen. Los paneles de diferencias, el historial y el grafo de git se han rehecho en todas las plataformas.
- El ruso sustituye al chino como idioma de la interfaz. Las pantallas de la aplicación están en inglés, francés, español y ruso.
- Las tarjetas gráficas AMD usan automáticamente la versión ROCm de llama.cpp cuando se publica. No hay ningún ajuste para ello.

### Correcciones

- Se ha eliminado el proveedor de cuenta Gemini.

## Números de versión

Una release tiene un número de compilación y una versión. La compilación 11 es la versión 3.0.11 y lleva la etiqueta `b-11` en GitHub.

## Obtener una versión nueva

Draggy se actualiza solo en Windows, macOS y Linux. [Instalación](doc:installation#updates) da los detalles.
