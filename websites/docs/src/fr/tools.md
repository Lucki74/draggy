---
title: "Outils et capacités"
description: "Recherche, navigateur, documents, fichiers et exécution de code."
section: control
---

## Créer des fichiers

Word depuis du Markdown, PowerPoint avec un titre par diapositive, Excel depuis du CSV ou du HTML, et des PDF mis en page par le moteur du navigateur. Joignez-les en retour et Draggy les lit. Un PDF scanné n'a pas de texte à extraire, et Draggy le dit.

Les compétences Word, Excel, PowerPoint et PDF sont toujours actives et ne se désactivent pas. Le modèle charge la bonne avant d'écrire le fichier.

Les types de fichiers exécutables et de scripts sont refusés lors de la création d'un document ou à l'ouverture d'un fichier. Les scripts et installateurs s'ouvrent dans leur dossier au lieu de s'exécuter.

## Exécuter du code

L'agent exécute les commandes et scripts dans le dossier du projet via le volet de terminal. Sous Windows, ils s'exécutent dans un [bac à sable](doc:permissions#sandbox). Chaque commande suit le mode d'autorisation actif. Une commande longue passe en tâche d'arrière-plan, que le modèle peut lire, attendre ou arrêter.

## Le dossier du chat

Sous Windows, chaque conversation de Chat a son propre dossier. Les fichiers que le modèle crée y sont enregistrés, et ses commandes s'y exécutent, toujours dans le [bac à sable](doc:permissions#sandbox) et sans réseau. Un Python livré avec Draggy est disponible : les scripts tournent sans rien installer. **Ouvrir le dossier du chat** l'ouvre dans l'Explorateur, le volet Fichiers liste son contenu, et un fichier s'ouvre dans un onglet d'aperçu modifiable. Le dossier est supprimé avec le chat.

## Vos propres documents

Indiquez un dossier dans `Paramètres → Chat → Bibliothèque` et son contenu est indexé sur votre machine, puis cherché par le sens.

## Désactiver des outils

Un outil qui n'est pas disponible à l'instant n'apparaît pas dans la liste que voit le modèle. La recherche web est coupée quand vous la mettez sur **Désactivé**, et les outils web partent avec elle.
