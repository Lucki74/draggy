---
title: "Frequently asked questions"
description: "Short answers about cost, privacy, hardware and updates."
section: fix
---

## Is Draggy free?

Yes. It costs nothing and has no paid tier. A provider you add bills you on its own terms.

## Does it need the internet?

Some things do: downloading models and speech models, web search, update checks, the ad blocker's filter lists, and any provider, cloud voice or cloud image model you add. By default, chat, code, document search and voice run on your computer.

## Do I need a graphics card?

No. Draggy picks a model your hardware can run. A dedicated graphics card usually makes it faster. [Choosing a model](doc:models) lists the models for each graphics card size.

## Can I use ChatGPT, Claude or Gemini with it?

Yes. Sign in with a ChatGPT or Claude plan, or add an API key for Google Gemini or another provider, from Settings, Providers. The built-in engine stays the default.

## What leaves my computer?

Draggy sends requests when you start them, such as model downloads and web searches. It also sends some on its own, such as update checks and ad blocker lists. Your conversations leave your computer only if you add a cloud provider. The [privacy policy](site:privacy-policy) names the services involved.

## Can I use models I already have?

Yes, with local servers. Start one, then press Scan under Settings, Providers. Draggy finds servers such as Ollama and LM Studio that run on this computer.

## Does it ask before it changes things?

In the default Accept edits mode, ordinary file edits go ahead without asking, but moving and deleting files ask first. Commands that only read run on their own inside a sandbox, and any other command asks first. Ask first also asks before each edit. Turbo goes ahead inside the project folder and asks before anything outside it. YOLO asks for nothing and has no sandbox. Plan only changes nothing. Edits made by the model can be undone; a command cannot, and deleted files go to the recycle bin.

## Why does my computer warn me when I open it?

Draggy's build is not signed with a developer certificate yet. Windows shows a warning on the first run. The steps to get past it are on the [download page](site:download#first-run).

## Does it update itself?

Yes. Draggy checks at every launch and every six hours. On Windows, an update found at launch downloads and installs in the startup window, unless you pick **Start without updating**. One found later downloads in the background, and an **Update ready** notice offers **Install now** or **Maybe later**. Install now installs it quietly and restarts Draggy.

## Which languages does it speak?

The app's screens are in English, French, Spanish and Russian. The natural voice speaks English, French and Spanish.

## Do I need an account?

No. Draggy has no account and no sign-in of its own. A provider you add may ask for its own key or sign-in.
