---
title: "Autorisations"
description: "Cinq modes, de la simple proposition au travail en autonomie."
section: control
---

Chaque appel d'outil passe par une vérification avant de s'exécuter, qu'il s'agisse d'un outil intégré ou d'une extension.

| Mode | Lit | Modifie | Supprime | Commandes |
| --- | --- | --- | --- | --- |
| Plan seulement | Oui | Non | Non | Non |
| Demander d'abord | Oui | Demande | Demande | Lecture seule sans demander, le reste demande |
| Accepter les modifications | Oui | Oui | Demande | Lecture seule sans demander, le reste demande |
| Turbo | Oui | Oui, dans le projet | Oui, dans le projet | Dans le bac à sable |
| [YOLO](doc:glossary#auto) | Oui | Oui | Oui | Oui |

![Le menu des modes d'autorisation ouvert dans un projet, avec Plan seulement, Demander d'abord, Accepter les modifications, Turbo et YOLO, et Accepter les modifications choisi.](shot:app-permission-modes)

> [!WARNING]
> **YOLO** n'a pas de bac à sable et atteint tout l'ordinateur. À réserver aux machines que vous pouvez restaurer.

**Accepter les modifications** est le mode par défaut. Chaque modification s'affiche en diff et peut être annulée. Chat, qui n'a pas de dossier de projet, fonctionne sans invite. Dans Code, `Paramètres → Code → Préférences → Les nouveaux projets démarrent en` fixe le mode dans lequel démarre un nouveau projet.

Le volet du navigateur demande avant que l'agent n'agisse sur un site : **Autoriser une fois** ou **Autoriser pour cette session**.

## Le bac à sable {#sandbox}

Sous Windows, les commandes s'exécutent dans un bac à sable. En **Demander d'abord** et **Accepter les modifications**, le dossier du projet leur est accessible en lecture seule et elles n'ont pas de réseau. En **Turbo**, elles peuvent écrire dans le dossier du projet et utiliser le réseau. Tout ce qui sort du dossier du projet demande votre accord d'abord, et le modèle doit le demander. **YOLO** n'a pas de bac à sable et couvre tout l'ordinateur. Il demande une confirmation quand vous l'activez, et une commande peut demander les droits administrateur, ce qui fait apparaître l'invite de Windows.

Les outils Node comme npm, npx et vitest ne fonctionnent pas dans le bac à sable. Quand le modèle en lance un, Draggy demande une fois, et après votre accord il s'exécute hors du bac à sable. La mise en place du bac à sable peut demander les droits administrateur la première fois. Windows les demande une fois par ordinateur, et non à chaque lancement.

## Lire ne demande jamais

Dans tous les modes, y compris le mode plan : lire et lister des fichiers, y chercher, l'état et les diffs git, la recherche web, votre bibliothèque de documents, charger une compétence, écrire le plan.

## La carte d'autorisation

![Un projet en Accepter les modifications, avec une carte qui demande l'approbation pour lancer npm test et les boutons pour y répondre.](shot:app-settings-code)

| Bouton | Portée |
| --- | --- |
| Autoriser une fois | Cet appel. Le suivant redemande. |
| Autoriser pour cette tâche | Ce type d'appel jusqu'à la fin de la réponse. |
| Toujours autoriser ici | Retenu pour ce projet. Pour une commande, il couvre le préfixe : autoriser `npm run` couvre tous les scripts. |
| Non | Refusé. Le modèle continue sans. |

`Paramètres → Code → Projets` liste tout ce que vous avez autorisé, chaque entrée avec **Retirer**.
