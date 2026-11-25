---
title: "Extensions et compétences"
description: "Serveurs MCP, serveurs distants, et une bibliothèque de {{n:skills}} compétences."
section: control
---

Draggy parle le [Model Context Protocol](https://modelcontextprotocol.io), donc il peut emprunter des outils à des [serveurs](doc:glossary#mcp-server) écrits par d'autres. `Paramètres → Extensions` a **Serveurs**, **Distants** et **Compétences**.

![Draggy exécutant la compétence proofreader pour corriger l'orthographe et la grammaire d'une phrase, en détaillant chaque modification apportée.](shot:app-skill-request)

## Ce qu'est vraiment un serveur {#what-a-server-is}

Un programme. Draggy l'installe avec npm dans son propre dossier et le lance directement, sur votre machine, sous votre compte, avec les identifiants que vous avez saisis. Les scripts d'installation sont refusés et aucun shell n'est impliqué.

Aucun serveur n'est activé par défaut, et chaque entrée nomme le paquet exact avec un lien vers npm. N'activez un serveur que si vous lanceriez ce paquet depuis un terminal.

## Le catalogue

{{n:mcp}} serveurs : GitHub, GitLab, Sentry, Slack, Notion, Linear, Jira, PostgreSQL, MySQL, MongoDB, Kubernetes, Cloudflare, Stripe et d'autres. Cherchez dans le registre pour le reste.

Les serveurs **distants** tournent ailleurs et sont joints en HTTPS. Un serveur local envoie lui aussi des requêtes au service avec lequel il travaille, comme GitHub. Les serveurs distants se connectent en OAuth avec PKCE.

## Compétences

Une compétence apprend au modèle comment se fait un travail. {{n:skills}} sont livrées avec Draggy, dont {{n:skillsOn}} activées par défaut. Tapez `/` puis son nom pour en lancer une, ou laissez le modèle choisir. Les compétences Word, Excel, PowerPoint et PDF et la compétence `draggy-help` sont toujours actives et n'ont pas d'interrupteur.

Les compétences Deep research, Fact check, News brief et Trend scan lisent des sources, les gardent dans une bibliothèque de recherche et les citent dans la réponse. Les citations introuvables sur la page sont signalées, et chaque exécution liste ses sources.

Une compétence est un dossier avec un `SKILL.md` dedans :

```markdown
---
name: weekly-report
description: Writes the Friday status report from the week's notes. Use when the user asks for the weekly report.
---

# Weekly report

1. Ask for the week's notes if they are not in the conversation.
2. Sort every item into Done, In progress, Blocked or Next week.
```

La description est la seule partie que le modèle voit au moment de choisir : faites-lui dire quand utiliser la compétence. Mettez les vôtres dans le dossier des compétences de Draggy, ou dans `.draggy/skills/` à l'intérieur d'un projet pour pouvoir les versionner. `/skill-creator` en rédige une avec vous.
