---
title: "Instalación"
description: "Lo que necesitas, el aviso del primer arranque y cómo llegan las actualizaciones."
section: start
---

## Lo que necesitas

Un ordenador capaz de ejecutar modelos de lenguaje [cuantizados](doc:glossary#quantization). La tarjeta gráfica es opcional. Normalmente hace que las respuestas lleguen antes.

- Windows 10 u 11 (64 bits), macOS 14 Sonoma o más reciente (Intel o Apple silicon), o Linux de 64 bits con WebKitGTK 4.1, como Ubuntu 24.04 o Fedora 40.
- Memoria: al menos 4 GB (Qwen 3.5 2B). Recomendado: 16 GB (Qwen 3.5 9B).
- Espacio libre en disco de 1,5 veces el tamaño del modelo: unos 0,8 GB para el modelo más pequeño, 9 GB para Qwen 3.5 9B.
- Tarjeta gráfica: opcional. Recomendado: 8 GB de memoria de vídeo con al menos 10 GB de memoria del sistema.

## Instalar

Descarga el instalador o el paquete para tu sistema operativo desde [la página de descarga](site:download) o desde [la página de versiones de GitHub](https://github.com/Lucki74/draggy/releases/latest):

> [!PLATFORMS]
> - Windows: Ejecuta `draggy_setup.exe`. Se instala solo para tu cuenta de usuario, en `%LOCALAPPDATA%\Programs\Draggy`. SmartScreen puede detener el instalador, porque la compilación todavía no está firmada con un certificado de desarrollador. Selecciona Más información y luego Ejecutar de todas formas.
> - macOS: Descarga el `.zip` universal, que funciona en Mac con Intel y con Apple silicon. Descomprímelo y mueve Draggy a Aplicaciones. La app está firmada ad hoc y no notarizada, así que la primera vez hay que ir a Ajustes del Sistema → Privacidad y seguridad → Abrir igualmente. También puedes ejecutar `xattr -dr com.apple.quarantine /Applications/Draggy.app` en Terminal.
> - Linux: Instala el .deb con `sudo apt install ./archivo.deb`, o el .rpm con `sudo dnf install ./archivo.rpm`. Para el AppImage, ejecuta `chmod +x` sobre él y luego ábrelo. Los paquetes necesitan WebKitGTK 4.1.

Cada release incluye un archivo `SHA256SUMS.txt`, por si prefieres comprobar antes que confiar.

## El primer inicio

La configuración elige un modelo que encaje con tu equipo y te pide que lo confirmes. La descarga empieza cuando pasas el paso del modelo, y viene de Hugging Face. El primer modelo ocupa entre unos 0,5 GB y 240 GB, según el equipo.

Cuando envías tu primer mensaje, Draggy carga el modelo en memoria. En los siguientes inicios, el modelo se queda en el disco hasta que envíes una petición, así que abrir la aplicación es instantáneo.

## Actualizaciones {#updates}

Windows, macOS y Linux usan todos el actualizador de Tauri con un feed de actualizaciones firmado. Draggy comprueba al iniciar y después cada seis horas. Una actualización encontrada al iniciar se instala en la pequeña ventana de arranque, y Draggy se reinicia con la nueva versión. **Iniciar sin actualizar** abre Draggy en el momento. Si la comprobación no recibe respuesta en unos segundos, Draggy arranca igualmente. Una actualización encontrada más tarde se descarga en segundo plano, y un aviso **Actualización lista** ofrece **Instalar ahora** o **Más tarde**. Instalar ahora la instala en silencio y reinicia Draggy. **Buscar actualizaciones** en Ajustes, General busca una al momento. Las compilaciones ejecutadas desde el código fuente no se actualizan.

Para eliminar Draggy, consulta [Desinstalar](doc:privacy#desinstalar) en la página de privacidad.
