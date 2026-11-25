---
title: "Moteurs locaux"
description: "Le moteur de Draggy, colibri et les serveurs locaux que Draggy peut utiliser."
section: providers
---

## Sur cet ordinateur

Le moteur Draggy vient en premier, avec les modèles téléchargés dans `Paramètres → Modèles`. En dessous, les serveurs locaux que Draggy connaît : [colibri](doc:glossary#colibri), Ollama, LM Studio, llama.cpp server, vLLM, SGLang, Jan, LocalAI, KoboldCpp, text-generation-webui, GPT4All, llamafile et Lemonade.

> [!NOTE]
> Le moteur colibri sert aux grands modèles à mélange d'experts qui ne tiennent pas en mémoire. Il lit des parties du modèle sur le disque au fur et à mesure, il est donc lent.

Lancez le serveur, puis appuyez sur **Rechercher**. Draggy essaie le port habituel de chacun sur cet ordinateur et liste les modèles trouvés. Pour un serveur sur un autre port ou une autre machine, indiquez son **Adresse** sous **Avancé**. Certains serveurs partagent un port par défaut (colibri, vLLM et Lemonade sur 8000 ; llama.cpp, LocalAI et llamafile sur 8080), donc une recherche peut afficher le mauvais.

## API locale

Draggy peut aussi servir ses propres modèles à d'autres programmes. Elle est désactivée par défaut, écoute sur `127.0.0.1:11500`, parle le format `/v1/chat/completions` d'OpenAI, demande une clé et répond à deux réponses à la fois. Elle se trouve sous `Paramètres → API locale`.
