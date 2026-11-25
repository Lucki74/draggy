---
title: "Glosario"
description: "Qué significan los términos de esta wiki y la página que explica cada uno."
section: reference
---

Un término enlaza a su entrada aquí la primera vez que aparece en la wiki.

### Motor {#engine}

Programa que carga un modelo y escribe sus respuestas. El motor de Draggy ejecuta modelos GGUF en tu ordenador. Ver [Proveedores](doc:local-engines#en-este-ordenador).

### colibri {#colibri}

El motor que Draggy usa para modelos grandes de mezcla de expertos que no caben en memoria. Lee partes del modelo desde el disco mientras avanza, así que va lento. Ver [Proveedores](doc:local-engines#en-este-ordenador).

### Proveedor {#provider}

Una fuente de modelos en Draggy: el motor integrado, un servidor en este ordenador, un proveedor en la nube con clave de API, o un plan de ChatGPT o Claude. Ver [Proveedores](doc:providers).

### GGUF {#gguf}

El formato de archivo de los modelos que ejecuta el motor de Draggy. Un modelo es un archivo `.gguf`, o varios en el caso de los modelos muy grandes. Ver [Elegir un modelo](doc:models#explorar-y-descargar).

### Cuantización {#quantization}

Una forma de guardar los números de un modelo con menos bits, lo que hace el archivo más pequeño. `Ajustes → Modelos` muestra cada variante de un modelo con el tamaño de su archivo. Ver [Elegir un modelo](doc:models#explorar-y-descargar).

### Ventana de contexto {#context-window}

La cantidad de texto, contada en tokens, que un modelo puede sostener a la vez. La rueda de contexto del campo de escritura muestra cuánto se ha llenado. Ver [Chat y Code](doc:chat-and-code#long-conversations).

### Compactación {#compaction}

Plegar la parte más antigua de una conversación larga en un resumen, para que la conversación pueda seguir. Ocurre en el límite de compactación: el 60% de la ventana de contexto por defecto, y como máximo 64.000 tokens para los modelos de pago en la nube, salvo que pongas un límite. Ver [Chat y Code](doc:chat-and-code#long-conversations).

### Servidor MCP {#mcp-server}

Un programa que da a Draggy más herramientas a través del Model Context Protocol. Draggy lo muestra en `Ajustes → Extensiones`. Ver [Extensiones y habilidades](doc:extensions#what-a-server-is).

### Habilidad {#skill}

Una carpeta con un archivo `SKILL.md` que enseña al modelo un tipo de trabajo. El modelo solo lee una habilidad cuando la petición encaja, y puedes lanzarla tú escribiendo `/` y su nombre. Ver [Extensiones y habilidades](doc:extensions#habilidades).

### Modelo de embeddings {#embedding-model}

Un modelo que convierte texto en vectores, que la biblioteca usa para buscar documentos por significado. No puede sostener una conversación. Ver [Elegir un modelo](doc:models).

### Hablar {#talk}

El modo de conversación hablada de Draggy, en la barra lateral de Chat. Escucha, detecta cuándo has terminado, responde en voz alta y te deja interrumpir. Ver [Modo de voz](doc:voice).

### Entorno aislado {#sandbox}

Espacio restringido en el que se ejecutan los comandos. En Windows ve la carpeta del proyecto y poco más, y no tiene red en **Preguntar antes** y **Aceptar cambios**. **YOLO** no lo tiene. Ver [Permisos](doc:permissions#sandbox).

### Turbo (modo de permisos) {#turbo}

El modo de permisos que edita, borra y mueve archivos en la carpeta del proyecto y ejecuta comandos en un entorno aislado, sin preguntar. Pregunta antes de salir de la carpeta. Ver [Permisos](doc:permissions).

### YOLO (modo de permisos) {#auto}

El modo de permisos que edita archivos y ejecuta comandos en todo el equipo, sin preguntar y sin entorno aislado. Úsalo en equipos que puedas restaurar. La búsqueda web también tiene un ajuste Automático, que no cambia los permisos. Ver [Permisos](doc:permissions).
