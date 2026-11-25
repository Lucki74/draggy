---
title: "Compilation et architecture"
description: "Lancer depuis les sources, l'organisation du code, et les deux frontières."
section: reference
---

## Prérequis

- **Windows** : Visual Studio C++ Build Tools et WebView2.
- **macOS** : Xcode Command Line Tools.
- **Linux** : `libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`, plus `rpm` pour construire le paquet rpm.

## Lancer depuis les sources

```bash
cd app
npm install
npm run tauri:dev
```

`tauri dev` prépare le sidecar `node` épinglé, puis lance Vite sur le port 5173 avec rechargement à chaud dans la fenêtre Tauri. Le fichier d'épinglage est `app/scripts/node-pin.json` sous Windows, `node-pin-macos.json` sous macOS et `node-pin-linux.json` sous Linux. Si un processus Vite resté en vie garde le port, le lancement suivant échoue : arrêtez-le d'abord.

```bash
npm run check
```

Typage, lint et les tests (`tsc -b`, `eslint .`, `vitest run`). La CI lance la même commande, plus `cargo fmt --check`, `cargo clippy` et `cargo test` dans `app/src-tauri/`. Sous Windows, `npm run tauri:build` écrit le programme d'installation NSIS dans `src-tauri/target/release/bundle/nsis/`. Sous macOS et Linux, utilisez `npx tauri build`.

## Comment c'est organisé

| Dossier | Contient |
| --- | --- |
| `core/` | Espace de travail Rust partagé : moteur, fournisseurs, outils, documents, MCP et stockage |
| `app/` | L'application Draggy pour Windows, macOS et Linux : `src-tauri/` pour le shell Rust et `src/` pour l'interface React |
| `legacy-macos/` | Retiré. L'application macOS en Swift, qui n'est plus livrée |
| `linux/` | Retiré. L'application Linux en GTK 4 et libadwaita, qui n'est plus livrée |
| `shared/` | Données de tarifs, jeux de test et icônes |

## Les deux frontières

La première concerne les fichiers de capacités Tauri. `app/src-tauri/capabilities/main.json` liste ce que la fenêtre principale peut appeler, et `browser-pane.json` n'accorde rien au panneau du navigateur. Le rendu n'atteint le système de fichiers, le réseau et la base de données qu'à travers les commandes de `app/src-tauri/src/ipc/`. Ajouter une commande ou une permission est un acte délibéré, et `app/src-tauri/tests/capabilities.rs` vérifie les fichiers.

La seconde est la Content Security Policy de `app/src-tauri/tauri.conf.json` (`app.security.csp`). Elle s'applique à la fenêtre de Draggy. `devCsp` ne s'applique que sous `tauri dev`. Les pages ouvertes par le panneau du navigateur ne sont pas soumises à cette politique : elles sont donc tenues à l'écart de la fenêtre principale.

## Journaux et diagnostics

Draggy conserve deux journaux rotatifs dans le dossier des données de l'application (`logs/`) :

- **`app.log`** : Événements du cycle de vie, gestion des modèles et erreurs. Les requêtes et les réponses sont réduites à des empreintes et des longueurs, et les secrets sont masqués.
- **`debug.log`** : Une trace plus détaillée. Le flux de sortie y est enregistré par longueur, pas par texte.

Les journaux tournent à 5 Mio et gardent trois archives. Pour les voir, ouvrez `Paramètres → Diagnostics → Ouvrir le dossier des journaux`, ou définissez `LOG_LEVEL=DEBUG` ou `DEBUG_LOG_LEVEL=DEBUG` pour le maximum de détails. Pour un signalement de bug, utilisez `Paramètres → Diagnostics → Exporter les diagnostics`.

## Moteur d'inférence

Draggy exécute des modèles locaux avec un moteur intégré :

- **GGUF (llama.cpp)** : Exécute des fichiers de modèles `.gguf` dans un processus enfant masqué `llama-server` sur le port `11435`. Sous Windows, la version CUDA est choisie lorsqu'une carte graphique disposant de mémoire est détectée, sinon Vulkan. Les cartes AMD utilisent la version ROCm avant Vulkan lorsqu'elle est publiée. Un seul moteur local tourne à la fois.

[CONTRIBUTING.md](https://github.com/Lucki74/draggy/blob/main/CONTRIBUTING.md) a le reste, et [SECURITY.md](https://github.com/Lucki74/draggy/blob/main/SECURITY.md) couvre le signalement d'une faille.

Le site et cette documentation sont dans le dépôt de l’app, sous [websites/www](https://github.com/Lucki74/draggy/tree/main/websites/www) et [websites/docs](https://github.com/Lucki74/draggy/tree/main/websites/docs).
