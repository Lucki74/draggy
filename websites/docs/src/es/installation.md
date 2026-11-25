---
title: "Instalación"
description: "Lo que necesitas, el aviso del primer arranque y cómo llegan las actualizaciones."
section: start
---

## Lo que necesitas

Un ordenador capaz de ejecutar modelos de lenguaje [cuantizados](doc:glossary#quantization). La tarjeta gráfica es opcional. Normalmente hace que las respuestas lleguen antes.

- Windows 10 u 11, de 64 bits.
- Memoria: al menos 4 GB (Qwen 3.5 2B). Recomendado: 16 GB (Qwen 3.5 9B).
- Espacio libre en disco de 1,5 veces el tamaño del modelo: unos 0,8 GB para el modelo más pequeño, 9 GB para Qwen 3.5 9B.
- Tarjeta gráfica: opcional. Recomendado: 8 GB de memoria de vídeo con al menos 10 GB de memoria del sistema.

## Instalar

Descarga el instalador o el paquete para tu sistema operativo desde [la página de descarga](site:download) o desde [la página de versiones de GitHub](https://github.com/Lucki74/draggy/releases/latest):

> [!PLATFORMS]
> - Windows: Ejecuta el `.exe` de instalación NSIS. Se instala solo para tu cuenta de usuario, en `%LOCALAPPDATA%\Programs\Draggy`. SmartScreen puede detener el instalador, porque la compilación todavía no está firmada con un certificado de desarrollador. Selecciona Más información y luego Ejecutar de todas formas.
> - macOS: Descarga el zip para Apple silicon, descomprímelo, haz clic derecho en Draggy.app y selecciona Abrir la primera vez.
> - Linux: Instala el paquete .deb con tu gestor de paquetes o dpkg, o el paquete .rpm con rpm o dnf.

Cada release incluye un archivo `SHA256SUMS.txt`, por si prefieres comprobar antes que confiar.

## El primer inicio

La configuración elige un modelo que encaje con tu equipo y te pide que lo confirmes. La descarga empieza cuando pasas el paso del modelo, y viene de Hugging Face. El primer modelo ocupa entre unos 0,5 GB y 240 GB, según el equipo.

Cuando envías tu primer mensaje, Draggy carga el modelo en memoria. En los siguientes inicios, el modelo se queda en el disco hasta que envíes una petición, así que abrir la aplicación es instantáneo.

## Actualizaciones {#updates}

Draggy comprueba si hay actualizaciones en cada inicio y después cada seis horas. En Windows, la comprobación del inicio se hace en la pequeña ventana que Draggy muestra al arrancar. Una actualización encontrada se descarga ahí con una barra de progreso, se instala y Draggy se reinicia con la nueva versión. **Iniciar sin actualizar** abre Draggy en el momento. Si la comprobación no recibe respuesta en unos segundos, Draggy arranca igualmente. Una actualización encontrada más tarde se descarga en segundo plano, y un aviso **Actualización lista** ofrece **Instalar ahora** o **Más tarde**. Instalar ahora la instala en silencio y reinicia Draggy. No hay ningún ajuste de actualizaciones, y las actualizaciones nunca se ejecutan desde una compilación de desarrollo.

En macOS, Draggy descarga él mismo el zip, comprueba su SHA-256 y cambia el paquete de la aplicación al salir. Si la carpeta no se puede escribir, abre la página de la versión. En Linux, Draggy descarga y verifica el paquete en segundo plano, y el aviso de reinicio instala el .deb o el .rpm con pkexec. Flatpak no hace nada, y sin pkexec Draggy abre la página de la versión. Si ejecutas desde el código fuente, las actualizaciones están desactivadas.

Para eliminar Draggy, consulta [Desinstalar](doc:privacy#desinstalar) en la página de privacidad.
