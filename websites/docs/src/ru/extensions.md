---
title: "Расширения и навыки"
description: "Серверы MCP, удалённые серверы и библиотека из {{n:skills}} навыков."
section: control
---

Draggy говорит на [Model Context Protocol](https://modelcontextprotocol.io), поэтому может брать инструменты с [серверов](doc:glossary#mcp-server), которые написали другие люди. В `Settings → Extensions` есть вкладки **Servers**, **Remote** и **Skills**.

![Draggy запускает навык проверки правописания, чтобы исправить орфографию и грамматику в предложении, и перечисляет все внесённые изменения.](shot:app-skill-request)

## Что такое сервер на самом деле {#what-a-server-is}

Это программа. Draggy устанавливает её через npm в собственную папку и запускает напрямую, на вашем компьютере, от вашего имени, с теми учётными данными, которые вы ввели. Скрипты установки не принимаются, и оболочка не задействуется.

Ни один сервер не включён по умолчанию, и каждая запись называет точный пакет со ссылкой на npm. Включайте сервер, только если вы запустили бы этот пакет из терминала.

## Каталог {#the-catalogue}

{{n:mcp}} серверов: GitHub, GitLab, Sentry, Slack, Notion, Linear, Jira, PostgreSQL, MySQL, MongoDB, Kubernetes, Cloudflare, Stripe и другие. Для всего остального ищите в реестре.

**Удалённые** серверы работают в другом месте и доступны по HTTPS. Локальный сервер тоже отправляет запросы сервису, с которым работает, например GitHub. Удалённые серверы входят через OAuth и PKCE.

## Навыки {#skills}

Навык учит модель тому, как выполнять задачу. С Draggy поставляются {{n:skills}} навыков, из них по умолчанию включены {{n:skillsOn}}. Введите `/` и имя навыка, чтобы запустить его, или оставьте выбор модели. Навыки Word, Excel, PowerPoint и PDF и навык `draggy-help` всегда включены, и переключателя у них нет.

Навыки Deep research, Fact check, News brief и Trend scan читают источники, сохраняют их в библиотеке исследований и ссылаются на них в ответе. Цитаты, которых нет на странице, помечаются, а каждый запуск перечисляет свои источники.

Навык — это папка с файлом `SKILL.md`:

```markdown
---
name: weekly-report
description: Writes the Friday status report from the week's notes. Use when the user asks for the weekly report.
---

# Weekly report

1. Ask for the week's notes if they are not in the conversation.
2. Sort every item into Done, In progress, Blocked or Next week.
```

Описание — единственная часть, которую модель видит при выборе, поэтому пусть оно говорит, когда использовать навык. Положите свой навык в папку навыков Draggy или в `.draggy/skills/` внутри проекта, чтобы его можно было закоммитить. `/skill-creator` составит его вместе с вами.
