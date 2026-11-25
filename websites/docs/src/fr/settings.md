---
title: "Paramètres"
description: "Chaque page de paramètres, et ce que chacune change."
section: customize
---

Trois groupes. **Application** concerne Draggy dans son ensemble, **Chat** et **Code** chacun son côté. `/settings` ouvre celui où vous êtes.

## Application

| Page | Contient |
| --- | --- |
| Général | Thème, taille du texte, langue de l'interface (anglais, français, espagnol ou russe), et la ligne de vitesse et mémoire sous chaque réponse |
| Modèles | Chaque modèle installé, le navigateur Hugging Face pour en ajouter, [la fenêtre de contexte](doc:glossary#context-window), [la limite de compactage](doc:glossary#compaction) et un bouton Décharger, ainsi que le modèle (local ou cloud) et la taille des images |
| Fournisseurs | Serveurs sur cet ordinateur, clés d'API et connexions avec un abonnement |
| Recherche web | Automatique, DuckDuckGo, Startpage, Brave Search, API Brave Search ou SearXNG |
| Statistiques | Réponses, tokens, vitesse par modèle, usage des outils, temps par tâche, coût par modèle, budgets et prix modifiables. Les réponses locales sont facturées au tarif OpenRouter du modèle sur lequel elles reposent |
| Données | Ce qui est stocké, et l'effacement de l'historique |
| Diagnostics | Le dossier des journaux, et Exporter les diagnostics pour un signalement de bug. L'export remplace votre dossier personnel et votre nom d'utilisateur |
| Extensions | Serveurs, serveurs distants et compétences |
| API locale | Une API compatible OpenAI sur cet ordinateur, désactivée par défaut |

![Les paramètres généraux de Draggy : thème clair ou sombre, taille du texte, langue, et l'interrupteur qui affiche la vitesse et la mémoire pendant qu'il répond.](shot:app-settings-general)

## Chat et Code

Chacun a ses **Préférences** : son modèle, son mode de réflexion, son accès au web et ses instructions personnalisées. Chat ajoute **Parler** et **Bibliothèque**. Code ajoute **Autorisations** et **Projets**, où chaque projet garde son mode de permission, son `AGENTS.md` ou `DRAGGY.md` et tout ce que vous avez toujours autorisé.

La page Bibliothèque indexe un dossier de documents par le sens, pour que les recherches dans Chat retrouvent les passages pertinents. L'indexation demande un modèle d'embedding. Draggy utilise celui que vous avez choisi, ou en choisit un adapté à votre carte graphique, et le télécharge la première fois que vous ajoutez un dossier.

Les instructions personnalisées sont ajoutées à chaque conversation de ce côté.

## L'API locale

Sur `127.0.0.1:11500`, en boucle locale uniquement, avec une clé Bearer obligatoire, et les requêtes portant un en-tête `Origin` sont refusées d'emblée pour qu'une page web ne puisse pas l'atteindre. Elle sert `/v1/models` et `/v1/chat/completions`.
