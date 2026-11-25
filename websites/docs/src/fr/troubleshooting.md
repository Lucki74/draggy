---
title: "Dépannage"
description: "Les problèmes courants et ce qui les règle."
section: fix
---

## Il reste sur l'écran de démarrage

Au premier lancement, Draggy télécharge un modèle, entre environ 0,5 Go et 240 Go selon le matériel. La durée dépend de votre connexion. Vérifiez la connexion, et vérifiez que vous avez libre 1,5 fois la taille du modèle sur le disque.

## Les réponses sont très lentes

Activez **Afficher vitesse et mémoire** dans `Paramètres → Général` et lisez le chiffre GPU. Une part GPU faible veut dire que le modèle déborde sur le processeur : descendez d'une taille dans `Paramètres → Modèles`.

## Le modèle décrit un appel d'outil au lieu de le faire

Si un appel d'outil échoue, coupez les outils dont vous n'avez pas besoin, puis renvoyez le message.

## Une extension ne démarre pas

| Message | Signifie |
| --- | --- |
| Pas encore configurée | Un champ obligatoire est vide. Ouvrez les champs de configuration. |
| Pas de réponse à temps | Le serveur n'a pas répondu à temps, et Draggy a cessé d'attendre. |
| npm introuvable | Installez Node.js et relancez Draggy. |

## Le mode vocal ne démarre pas

Si Draggy dit qu'il ne peut pas utiliser le micro, autorisez-le dans les paramètres de confidentialité de votre système. Si le message indique **Aucune voix de synthèse n'est installée sur ce système**, ajoutez-en une dans les paramètres du système, ou utilisez la voix **Naturelle**.

## Une commande a échoué faute d'accès ou de réseau

Sous Windows, les commandes s'exécutent dans un [bac à sable](doc:permissions#sandbox). En **Demander d'abord** et **Accepter les modifications**, le dossier du projet y est en lecture seule et il n'y a pas de réseau : une commande comme `npm install` échoue donc. Le modèle peut demander à lancer cette seule commande hors du bac à sable, et vous répondez sur une carte. **Turbo** autorise l'écriture et le réseau dans le bac à sable.

## Il a refusé un chemin ou une adresse locale

Le modèle ne peut atteindre que le dossier du projet, et ne peut récupérer que des adresses `http` et `https` publiques. Joignez le fichier vous-même, ou ouvrez la page dans le navigateur.

## Les mises à jour n'arrivent jamais

Les mises à jour ne fonctionnent que dans une version installée. Depuis les sources, elles sont désactivées.

## Toujours bloqué

`Paramètres → Diagnostics → Ouvrir le dossier des journaux` ouvre les journaux. **`app.log`** contient les événements, avec les requêtes et les secrets réduits. Pour un signalement de bug, utilisez `Paramètres → Diagnostics → Exporter les diagnostics`, qui remplace aussi votre dossier personnel et votre nom d'utilisateur. Ensuite, [ouvrez un ticket](https://github.com/Lucki74/draggy/issues) avec le message que vous avez vu.
