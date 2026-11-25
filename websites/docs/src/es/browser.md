---
title: "Navegador"
description: "Buscar en la web, leer páginas y manejar una ventana de navegador real."
section: use
---

## La web y el navegador

`search_web` ejecuta una búsqueda; `read_url` obtiene una página y extrae su texto. Ambas aceptan `http` y `https` solo en internet público, así que no se pueden dirigir a un archivo local. La herramienta del navegador también rechaza las direcciones privadas, incluidos los nombres públicos que apuntan a tu red local. <kbd>Ctrl</kbd>+<kbd>Mayús</kbd>+<kbd>B</kbd> abre el panel del navegador.

Para sitios en los que hay que hacer clic, Draggy controla una ventana de navegador real. Cuando el agente visita una página, el panel se abre para mostrarla. En Windows, el panel es una ventana WebView2. Su bloqueador de anuncios usa listas de filtros de uBlock Origin, EasyList y AdGuard sobre el motor adblock-rust, y puedes desactivar el bloqueo en el panel.

![Una página de prueba de bloqueo de anuncios abierta en la ventana de navegación de Draggy, con su puntuación de protección visible.](shot:app-browser)

Una página detrás de una comprobación de Cloudflare o de un captcha se marca como que necesita a una persona. Pásala tú mismo en el navegador, y el modelo podrá leer el sitio después, porque compartís la misma sesión.
