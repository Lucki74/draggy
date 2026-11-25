---
title: "Confidentialité et données"
description: "Ce qui quitte la machine, ce qui est conservé, et où."
section: fix
---

Draggy n'a pas de compte et n'envoie aucune télémétrie. Les requêtes qu'il fait, comme les vérifications de mise à jour et les téléchargements de modèles, atteignent les hôtes listés ci-dessous. Sauf si vous ajoutez un fournisseur cloud, le modèle qui vous répond est un processus sur votre propre ordinateur, joint via `127.0.0.1`.

## Ce qui atteint le réseau

| Quoi | Où |
| --- | --- |
| Téléchargement de modèles | Hugging Face (huggingface.co). Les moteurs viennent de GitHub |
| Recherches web | Le fournisseur que vous choisissez. En automatique, plusieurs sont essayés à tour de rôle. |
| Pages lues ou ouvertes | Le site concerné |
| Icônes des résultats | Le site de chaque résultat, pas un service de favicons |
| Listes du bloqueur de publicités | GitHub (listes uBlock Origin, EasyList et AdGuard) et oisd.nl (OISD), en arrière-plan lorsque le blocage est activé |
| Prix affichés pour les coûts et taux de change | GitHub (liste de prix LiteLLM), OpenRouter (liste des modèles) et api.frankfurter.dev. Requêtes GET uniquement, sans données de chat |
| Modèles vocaux | Hugging Face, au premier usage seulement |
| Vérification et téléchargement des mises à jour | Les versions sur GitHub |
| Vérification de connexion à la première configuration | Hugging Face, une requête, quand aucun modèle n'est installé |
| Extensions activées | npm, puis le service concerné |
| Un fournisseur cloud que vous ajoutez | Ce fournisseur |
| Un modèle d'image cloud que vous choisissez | Ce fournisseur |
| Une voix cloud que vous acceptez | Ce fournisseur, le texte de la réponse de l'assistant seulement |
| La connexion avec ChatGPT ou Claude | OpenAI ou Anthropic, par l'outil ou le protocole de ce fournisseur |
| Claude Code, au démarrage d'une connexion Claude | L'API d'Anthropic, une requête de démarrage |
| La liste des fournisseurs | draggy.org, au plus une fois par jour, une fois un fournisseur cloud activé |

Le tableau liste les requêtes faites par Draggy. Le blocage des publicités reste actif tant que vous ne le désactivez pas dans le volet du navigateur. Draggy fait aussi une vérification de connexion à la première configuration, quand aucun modèle n'est installé. Pour envoyer moins de requêtes, mettez la recherche web sur **Désactivé**, laissez les extensions éteintes, n'ajoutez aucun fournisseur cloud, voix cloud ni modèle d'image cloud. La vérification des mises à jour n'a aucun interrupteur. Les téléchargements de modèles et les modèles vocaux utilisés pour la première fois ont toujours besoin du réseau.

## Où tout est gardé

| Système | Dossier |
| --- | --- |
| Windows | `%APPDATA%\Draggy` |
| macOS | `~/Library/Application Support/Draggy` |
| Linux | `$XDG_DATA_HOME/Draggy`, ou `~/.local/share/Draggy` si cette variable n'est pas définie |

Dedans : `draggy.db` pour les conversations et les paramètres, `library.db` pour l'index des documents, `secrets.bin` pour les clés des fournisseurs et les identifiants d'extensions chiffrés par le trousseau de votre système, les dossiers de connexion ChatGPT et Claude, et des dossiers pour les fichiers créés, les dossiers de chat (`chats`, sous Windows), les exécutions de code, les modèles vocaux et les serveurs installés.

Les données des versions de l'ère Electron sont transférées dans ce dossier au premier lancement, y compris l'ancien dossier `localai`. Copiez le dossier pour sauvegarder ou changer de machine, Draggy fermé. Supprimez-le pour repartir de zéro. Les identifiants de `secrets.bin` sont liés à cette machine et à ce compte : il faudra les ressaisir ailleurs.

## Désinstaller

> [!NOTE]
> Retirer l'application laisse ce dossier en place, pour qu'une réinstallation retrouve vos conversations. Supprimez le dossier pour retirer tout ce que Draggy garde, y compris les dossiers de connexion ChatGPT et Claude.
