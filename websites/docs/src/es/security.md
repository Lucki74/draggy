---
title: "Seguridad"
description: "Lo que Draggy puede hacer, lo que rechaza y cómo informar de un problema."
section: fix
---

Esta página reúne en un solo lugar los límites y las comprobaciones de Draggy. Cada sección enlaza a la página que lo explica completo. Algunas solicitudes salen sin que las pidas, como las comprobaciones de actualizaciones.

## Modos de permisos

Cada llamada a una herramienta pasa por una misma comprobación antes de ejecutarse. El modo elegido decide qué pide confirmación primero.

- **Solo planificar** lee el proyecto y propone cambios. No cambia nada y no ejecuta comandos.
- **Preguntar antes** pregunta antes de cada cambio en tus archivos y de cada comando que no sea de solo lectura.
- **Aceptar cambios**, el valor por defecto en proyectos nuevos, edita archivos sin preguntar. Pregunta antes de borrar y antes de los comandos que no son de solo lectura.
- **Turbo** edita, borra y mueve archivos dentro de la carpeta del proyecto y ejecuta comandos en un entorno aislado, sin preguntar. Pregunta antes de salir de la carpeta.
- **YOLO** edita, borra y ejecuta comandos en todo el equipo, sin preguntar y sin entorno aislado.

Leer nunca pregunta, en ningún modo. La tabla completa está en la página [Permisos](doc:permissions).

## Carpetas y archivos rechazados

Draggy los rechaza sea cual sea el modo.

- Carpetas como `.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`, `.password-store`
- Archivos como `.env`, `id_rsa`, `.pem`, `.pfx`, `.npmrc`, `.netrc`, `.git-credentials`, `credentials`
- Cualquier lectura de más de 2 MB

Los tipos de archivo ejecutables y de script se rechazan al crear un documento o al abrir un archivo. Los scripts e instaladores se abren en su carpeta en lugar de ejecutarse. La lista completa está en la página [Proyectos](doc:projects#lo-que-se-rechaza-de-todos-modos), y [Herramientas y capacidades](doc:tools#crear-archivos) trata los documentos.

## Ejecutar código

En Windows, los comandos se ejecutan en un entorno aislado que alcanza la carpeta del proyecto y poco más. **Preguntar antes** y **Aceptar cambios** dejan la carpeta en solo lectura y cortan la red; **Turbo** permite escribir y usar la red. Las variables de entorno cuyo nombre parece una clave, un token o una contraseña se eliminan antes de que arranque un comando en el entorno aislado. Donde no hay entorno aislado, y en **YOLO**, los comandos se ejecutan directamente en tu equipo con tu cuenta de usuario. La salida de más de 30 000 caracteres se recorta por el medio. Las páginas [Comandos](doc:tools#ejecutar-código) y [Permisos](doc:permissions) detallan los límites y reglas.

## Servidores remotos y lo que alcanzan

Un servidor MCP es un programa que da a Draggy más herramientas. Uno local se instala con npm en su propia carpeta y se ejecuta directamente en tu equipo, con tu usuario y con las credenciales que hayas escrito. Los scripts de instalación se rechazan y no interviene ningún shell. Ningún servidor está activado por defecto.

Un servidor remoto se ejecuta en otro lugar y se llega a él por HTTPS. Los servidores remotos inician sesión con OAuth y PKCE. Un servidor local también envía solicitudes al servicio con el que trabaja, como GitHub. La página [Privacidad y datos](doc:privacy#qué-llega-a-la-red) indica adónde va cada tipo de solicitud, y [Extensiones y habilidades](doc:extensions#el-catálogo) trata los servidores.

## Registros y diagnóstico

**`app.log`** contiene eventos, con los mensajes y las respuestas reducidos a hashes y longitudes, y los secretos eliminados. `debug.log` registra la salida en flujo por su longitud, no por su texto.

Para un informe de error, usa `Ajustes → Diagnóstico → Exportar diagnóstico`. Sustituye tu carpeta personal y tu nombre de usuario, pero revisa el archivo antes de compartirlo. Los pasos están en [Sigue sin funcionar](doc:troubleshooting#sigue-sin-funcionar).

## Descargas

Descarga Draggy solo desde este sitio o desde la página de versiones de GitHub. La versión de Windows no está firmada con un certificado de desarrollador. Cada release incluye un archivo `SHA256SUMS.txt`, y Draggy comprueba cada actualización que descarga. El primer inicio se explica en la página [Instalación](doc:installation).

## Informar de una vulnerabilidad

Usa el formulario privado de GitHub para informar, en lugar de una incidencia pública. Di qué hiciste, qué pasó y qué esperabas. Una prueba de concepto, aunque sea tosca, es bienvenida. Indica el número de compilación de Draggy, y tu sistema operativo si importa.

[Informar de una vulnerabilidad en GitHub](https://github.com/Lucki74/draggy/security/advisories/new). La política completa está en [SECURITY.md](https://github.com/Lucki74/draggy/blob/main/SECURITY.md).
