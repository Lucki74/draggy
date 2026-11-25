---
title: "Commandes"
description: "Ce que le modèle peut exécuter, dans quel shell, et ce que couvre une autorisation."
section: control
---

Dans Code, le modèle exécute des commandes dans le dossier du projet : git, gh, gestionnaires de paquets, tests, compilations. **Demander d'abord** et **Accepter les modifications** lancent d'eux-mêmes les commandes en lecture seule et demandent pour les autres, avec la commande complète affichée avant. **Turbo** et **YOLO** les lancent sans demander. Plan seulement refuse les commandes. Sous Windows, elles s'exécutent dans un [bac à sable](doc:permissions#sandbox).

## Quel shell

Le modèle peut choisir `pwsh`, `powershell`, `cmd`, `bash` ou `sh`. S'il n'en choisit aucun sous Windows, Draggy utilise `bash` si Git pour Windows est installé, puis PowerShell 7, puis Windows PowerShell. `bash` vient de Git pour Windows, et non de WSL. Dans le [bac à sable](doc:permissions#sandbox) de Windows, seul `cmd` démarre : les commandes y tournent donc dans `cmd`, et le résultat le signale si le modèle avait choisi un autre interpréteur.

## Commandes d'outils en arrière-plan

Quand le modèle exécute une commande via un outil, elle tourne en arrière-plan sans invite interactive. Les invites et les pagineurs sont coupés (`GIT_TERMINAL_PROMPT=0`, `PAGER=cat`, `GIT_PAGER=cat`, `NO_COLOR=1`). Une commande encore en cours après deux minutes passe en tâche d'arrière-plan ; <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd> l'envoie en arrière-plan à la demande.

## Le panneau de terminal

Pour les commandes interactives, les éditeurs de texte, les opérations git ou les REPL, appuyez sur <kbd>Ctrl</kbd>+<kbd>Maj</kbd>+<kbd>T</kbd> (<kbd>⌘</kbd><kbd>Maj</kbd><kbd>T</kbd> sur macOS) pour ouvrir le terminal dans le dock. Il gère plusieurs onglets et des shells personnalisés (`pwsh`, `cmd`, `bash`, `sh`). Les blocs de code dans les discussions ont aussi un bouton pour envoyer directement une commande au terminal.

## Limites

- Deux minutes par défaut, dix si le modèle le demande
- Au-delà de 30 000 caractères, la sortie est coupée au milieu, les deux bouts gardés
- Arrêter la réponse arrête la commande et tout ce qu'elle a lancé

## Toujours autoriser reste étroit

Ce qui est retenu, c'est le début de la commande, pas la ligne entière. Autoriser `npm test --watch` autorise `npm test` ; cela n'autorise pas `npm publish`. Tout ce qui peut exécuter n'importe quoi, comme `python` ou `bash`, est retenu en entier. Chaque commande d'une chaîne compte séparément.

**Une commande ne s'annule pas.** Draggy ne voit pas ce qu'elle a fait, donc un `git checkout .` est aussi définitif que dans votre terminal.

Les raccourcis clavier ont leur propre page : [Raccourcis clavier](doc:shortcuts).
