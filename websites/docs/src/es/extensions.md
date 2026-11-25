---
title: "Extensiones y habilidades"
description: "Servidores MCP, servidores remotos y una biblioteca de {{n:skills}} habilidades."
section: control
---

Draggy habla el [Model Context Protocol](https://modelcontextprotocol.io), así que puede tomar prestadas herramientas de [servidores](doc:glossary#mcp-server) escritos por otros. `Ajustes → Extensiones` tiene **Servidores**, **Remotos** y **Habilidades**.

![Draggy ejecutando la habilidad proofreader para corregir la ortografía y gramática de una frase, detallando cada cambio realizado.](shot:app-skill-request)

## Qué es realmente un servidor {#what-a-server-is}

Un programa. Draggy lo instala con npm en su propia carpeta y lo ejecuta directamente, en tu equipo, con tu usuario, con las credenciales que hayas escrito. Los scripts de instalación se rechazan y no interviene ningún shell.

Ningún servidor está activado por defecto, y cada entrada indica el paquete exacto con un enlace a npm. Actívalo solo si ejecutarías ese paquete desde una terminal.

## El catálogo

{{n:mcp}} servidores: GitHub, GitLab, Sentry, Slack, Notion, Linear, Jira, PostgreSQL, MySQL, MongoDB, Kubernetes, Cloudflare, Stripe y más. Busca en el registro cualquier otro.

Los servidores **remotos** se ejecutan en otro lugar y se llega a ellos por HTTPS. Un servidor local también envía solicitudes al servicio con el que trabaja, como GitHub. Los servidores remotos inician sesión con OAuth y PKCE.

## Habilidades

Una habilidad enseña al modelo cómo se hace un trabajo. Draggy trae {{n:skills}} habilidades, de las cuales {{n:skillsOn}} vienen activadas por defecto. Escribe `/` y su nombre para ejecutar una, o deja que lo decida el modelo. Las habilidades de Word, Excel, PowerPoint y PDF y la habilidad `draggy-help` están siempre activas y no tienen interruptor.

Las habilidades Deep research, Fact check, News brief y Trend scan leen fuentes, las guardan en una biblioteca de investigación y las citan en la respuesta. Las citas que no están en la página se marcan, y cada ejecución enumera sus fuentes.

Una habilidad es una carpeta con un `SKILL.md` dentro:

```markdown
---
name: weekly-report
description: Writes the Friday status report from the week's notes. Use when the user asks for the weekly report.
---

# Weekly report

1. Ask for the week's notes if they are not in the conversation.
2. Sort every item into Done, In progress, Blocked or Next week.
```

La descripción es lo único que ve el modelo al elegir, así que haz que diga cuándo usar la habilidad. Pon las tuyas en la carpeta de habilidades de Draggy, o en `.draggy/skills/` dentro de un proyecto para poder versionarlas. `/skill-creator` redacta una contigo.
