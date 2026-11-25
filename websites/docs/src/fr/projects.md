---
title: "Projets"
description: "Donnez un dossier à Code. Il y lit, modifie et exécute des commandes, et nulle part ailleurs."
section: use
---

Un projet, c'est un dossier dans lequel Code travaille. Chaque chemin est résolu en suivant les liens symboliques, puis vérifié contre ce dossier : ni `..` ni un lien qui sort de l'arborescence ne mène ailleurs.

![Un projet dans Draggy : l'arborescence avec ses changements git, la modification du test par le modèle affichée en diff, npm test autorisé et réussi, et format.ts ouvert à côté d'un plan terminé.](shot:app-project)

## Ce qui reste refusé

- Les dossiers comme `.ssh`, `.aws`, `.gnupg`, `.kube`
- Les fichiers comme `.env`, `id_rsa`, `.pem`, `.npmrc`, `credentials`
- Types exécutables et de scripts comme `.exe`, `.bat`, `.ps1` et `.py`
- Tout ce qui dépasse 2 Mo

## Tout changement est annulable

Une étape qui a modifié un fichier affiche un diff et un bouton **Annuler**. Les octets précédents sont gardés dans le dossier propre à Draggy, donc l'annulation marche même dans un dossier qui n'est pas un dépôt. Un fichier supprimé va dans la corbeille du système.

## Le canevas

Cliquez un fichier dans l'arborescence et il s'ouvre à côté de la conversation : un fichier de code en édition, ou du Markdown avec un choix entre **Éditer** et **Aperçu**. Les modifications du modèle sur le même fichier y apparaissent au fur et à mesure.

**Fichiers** dans la barre latérale montre la même arborescence en grand, avec renommer, révéler et supprimer à côté de l'éditeur.

## Git

Dans un dépôt, un bandeau sous l'arborescence montre la branche, ce qui n'est pas poussé et ce qui a changé, avec un bouton **Diff** par fichier. Le panneau Diff inclut des onglets **Historique** et **Branches** pour inspecter les commits et changer de branche locale sans quitter l'application. Le modèle passe par `git_status`, `git_diff`, `git_log` et `git_branches`, et peut ajouter des fichiers à la préparation, les en retirer et committer avec `git_stage`, `git_unstage` et `git_commit`, qui demandent d'abord, comme le changement de branche. Les outils de lecture ne commitent ni ne récupèrent jamais, et ils tournent avec les filtres, les outils de diff externes et fsmonitor désactivés. Une commande que le modèle lance avec `run_command` peut encore exécuter `git commit` ou `git fetch`, une fois que vous l'avez approuvée.

## Bilan des modifications

Quand une tâche en plusieurs étapes s'achève, Draggy affiche un récapitulatif indiquant le nombre de fichiers créés, modifiés et supprimés.

## Mémoire du projet

Un `AGENTS.md` ou un `DRAGGY.md` à la racine du projet est lu avant chaque réponse. Mettez-y ce qu'il faudrait dire à quelqu'un qui arrive : comment lancer les tests, ce qu'il ne faut pas toucher, les conventions. `/init` en rédige un.
