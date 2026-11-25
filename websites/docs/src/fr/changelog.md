---
title: "Journal des modifications"
description: "Où trouver les notes de version et comment les versions sont numérotées."
section: reference
---

Chaque build de Draggy est une release sur GitHub, avec ses notes et ses installateurs : [versions de Draggy](https://github.com/Lucki74/draggy/releases).

## Build 13

- Draggy démarre dans une petite fenêtre qui cherche une mise à jour, la télécharge et redémarre sur la nouvelle version. **Démarrer sans mettre à jour** la saute.
- Après une mise à jour, la fenêtre de démarrage affiche la nouvelle version.

### Corrections

- Toutes les compétences de la bibliothèque intégrée sont installées.
- Les longs messages en alphabet non latin ne sont plus pris pour du binaire.

### Sécurité

- Les commandes lancées en administrateur ne passent plus par une fenêtre PowerShell cachée.

## Build 12

- Les réponses affichent les images générées ou trouvées sur le web. Cliquez pour ouvrir la visionneuse.
- Les modèles d'image cloud d'un fournisseur connecté apparaissent dans Réglages, à côté des modèles locaux.
- Le modèle vocal cloud et le nom de voix se choisissent dans les réglages Parler.
- Les statistiques valorisent les réponses locales au tarif OpenRouter du modèle, avec une ventilation par modèle.
- Une note de guidage peut être reprise, puis modifiée.
- La recherche signale les citations introuvables sur la page et liste les sources de chaque exécution.

### Corrections

- Le modèle cloud par défaut s'ouvre au démarrage.
- llama.cpp ne réutilise plus un contexte périmé.
- La recherche web pendant une recherche attend la fin du délai.
- Le volet navigateur s'ouvre lorsque l'agent visite une page.
- Le message « Chargement du modèle vocal » est corrigé.

### Sécurité

- Les adresses privées résolues par DNS sont bloquées.
- Davantage de types exécutables sont refusés.
- Les scripts et installateurs s'ouvrent dans leur dossier au lieu de s'exécuter.

## Build 11

Version 3.0.11, étiquette `b-11` sur GitHub.

- L'application Windows tourne sur Tauri au lieu d'Electron. Vos réglages, vos conversations et vos clés enregistrées sont conservés, et l'ancienne installation est supprimée après la mise à jour.
- Sous Windows, les commandes de l'agent s'exécutent dans un bac à sable qui voit le dossier du projet et les outils de votre PATH.
- npm, npx, vitest et les autres outils Node demandent une fois, puis s'exécutent hors du bac à sable, où ils fonctionnent.
- **Toujours autoriser ici** couvre un préfixe de commande : autoriser `npm run` couvre tous les scripts.
- Le panneau navigateur bloque plus de publicités, filtres scriptlet compris, et sa fenêtre détachée a sa propre barre.
- Les boutons de la fenêtre sont dessinés dans la barre de titre de l'application.

### Corrections

- Les commandes Node ne restent plus bloquées dans le bac à sable et ne sont plus relancées pendant des dizaines d'étapes.
- L'invite administrateur du bac à sable apparaît une fois par ordinateur, et non à chaque lancement.
- Les commandes dans le bac à sable peuvent lister les dossiers au-dessus du projet, donc PowerShell et `dir` y fonctionnent.

## Build 10

Version 3.0.10, étiquette `b-10` sur GitHub.

- Draggy se met à jour tout seul sous Windows, macOS et Linux. Il vérifie à chaque lancement, dans un délai de 4 secondes, puis toutes les six heures. Une mise à jour trouvée s'installe dans une petite fenêtre « Updating Draggy », puis l'application redémarre. Un résultat tardif s'installe à la fermeture, ou depuis un avis de redémarrage que vous pouvez fermer. Il n'y a plus de réglage des mises à jour.
- macOS télécharge lui-même le zip, vérifie son SHA-256 et remplace le bundle de l'application après la fermeture de Draggy. Si le dossier n'est pas accessible en écriture, la page de la version s'ouvre à la place.
- Linux télécharge et vérifie la mise à jour en arrière-plan, puis installe le .deb ou le .rpm avec pkexec depuis l'avis de redémarrage. Flatpak ne fait rien. Sans pkexec, la page de la version s'ouvre.
- Les versions contiennent un fichier SHA256SUMS.txt.
- Chaque appel d'outil s'affiche en direct dans le chat : son nom et ses arguments apparaissent pendant que le modèle les écrit, et ses étapes restent dans le chat quand vous le rouvrez.
- Les appels d'outils en lecture seule s'exécutent en parallèle.
- Deep research, Fact check, News brief et Trend scan lisent des sources, les gardent dans une bibliothèque de recherche et les citent dans la réponse.
- Les tours de l'assistant sont refaits : le travail d'un tour se replie en un seul résumé. Les volets de différences, l'historique et le graphe git sont retravaillés sur toutes les plateformes.
- Le russe remplace le chinois comme langue de l'interface. Les écrans de l'application sont en anglais, français, espagnol et russe.
- Les cartes graphiques AMD utilisent automatiquement la version ROCm de llama.cpp lorsqu'elle est publiée. Il n'y a pas de réglage pour cela.

### Corrections

- Suppression du fournisseur de compte Gemini.

## Numéros de version

Une release a un numéro de build et une version. La build 11 est la version 3.0.11 et porte l'étiquette `b-10` sur GitHub.

## Obtenir une nouvelle version

Draggy se met à jour tout seul sous Windows, macOS et Linux. [Installation](doc:installation#updates) donne les détails.
