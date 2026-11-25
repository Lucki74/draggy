---
title: "Browser"
description: "Search the web, read pages and drive a real browser window."
section: use
---

## Web and the browser

`search_web` runs a query; `read_url` fetches a page and extracts its text. Both accept `http` and `https` on the public internet only, so they cannot be pointed at a local file. The browser tool refuses private addresses too, including public names that point at your local network. <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> opens the pane.

For sites that need clicking through, Draggy drives a real browser window. When the agent visits a page, the pane opens to show it. The pane uses WebView2 on Windows, WKWebView on macOS and WebKitGTK on Linux. Its ad blocker runs filter lists from uBlock Origin, EasyList and AdGuard on the adblock-rust engine, and you can switch blocking off in the pane.

![An ad blocker test page open in Draggy's own browser window, with its protection score shown.](shot:app-browser)

A page behind a Cloudflare or captcha check is reported as needing a person. Pass it yourself in the browser, and the model can read the site afterwards, because you share one session.
