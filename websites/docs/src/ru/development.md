---
title: "Сборка и архитектура"
description: "Запуск из исходников, структура кода и две границы."
section: reference
---

## Запуск из исходного кода

```bash
cd win
npm install
npm run tauri:dev
```

`tauri dev` подготавливает sidecar `node.exe`, затем запускает Vite на порту 5173 с горячей перезагрузкой внутри окна Tauri. Если устаревший процесс Vite занимает порт, следующий запуск завершится ошибкой, поэтому сначала остановите его.

```bash
npm run check
```

Проверка типов, линтинг и тесты (`tsc -b`, `eslint .`, `vitest run`). CI запускает ту же команду, а также `cargo fmt --check`, `cargo clippy` и `cargo test` в `win/src-tauri/`. `npm run tauri:build` подготавливает sidecar и записывает установщик NSIS в `src-tauri/target/release/bundle/nsis/`.

## Структура

| Папка | Содержит |
| --- | --- |
| `core/` | Общее рабочее пространство Rust: движок, провайдеры, инструменты, документы, MCP и хранилище |
| `win/` | Приложение Tauri 2 для Windows: `src-tauri/` для оболочки на Rust и `src/` для фронтенда на React |
| `macos/` | Нативное приложение для macOS на SwiftUI |
| `linux/` | Нативное приложение для Linux на GTK 4 и libadwaita |
| `shared/` | Данные о ценах, фикстуры и иконки приложения |

## Две границы

Первая граница: файлы возможностей Tauri. `win/src-tauri/capabilities/main.json` перечисляет, что может вызывать главное окно, а `browser-pane.json` не выдаёт панели браузера никаких прав. Рендерер обращается к файловой системе, сети и базе данных только через команды в `win/src-tauri/src/ipc/`. Добавление команды или разрешения требует осознанного решения, а `win/src-tauri/tests/capabilities.rs` проверяет эти файлы.

Вторая граница: Content Security Policy в `win/src-tauri/tauri.conf.json` (`app.security.csp`). Она применяется к окну самого Draggy. `devCsp` действует только при `tauri dev`. Страницы, которые открывает панель браузера, не находятся под этой политикой, поэтому они отделены от главного окна.

## Журналы и диагностика

Draggy хранит два ротируемых журнала в папке данных приложения (`logs/`):

- **`app.log`**: события жизненного цикла, управление моделями и ошибки. Запросы и ответы сводятся к хешам и длинам, а секреты удаляются.
- **`debug.log`**: более подробная трассировка. Потоковый вывод записывается по длине, а не по тексту.

Журналы ротируются при 5 МиБ и хранят три архива. Чтобы их открыть, выберите `Settings → Diagnostics → Open log folder`, или задайте `LOG_LEVEL=DEBUG` либо `DEBUG_LOG_LEVEL=DEBUG` для самых подробных записей. Для отчёта об ошибке используйте `Settings → Diagnostics → Export diagnostics`.

## Движок вывода

Draggy запускает локальные модели встроенным движком:

- **GGUF (llama.cpp)**: запускает файлы моделей `.gguf` в скрытом дочернем процессе `llama-server` на порту `11435`. На macOS используется Metal. В Windows CUDA выбирается, когда найдена видеокарта с памятью, иначе Vulkan. Карты AMD сначала используют сборку ROCm, когда она опубликована, затем Vulkan. Одновременно работает только один локальный движок.

Остальное описано в [CONTRIBUTING.md](https://github.com/Lucki74/draggy/blob/main/CONTRIBUTING.md), а сообщить об уязвимости можно по инструкции в [SECURITY.md](https://github.com/Lucki74/draggy/blob/main/SECURITY.md).

Сайт и эта документация лежат в репозитории приложения, в папках [websites/www](https://github.com/Lucki74/draggy/tree/main/websites/www) и [websites/docs](https://github.com/Lucki74/draggy/tree/main/websites/docs).
