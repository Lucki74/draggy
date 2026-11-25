---
title: "Démarrage rapide"
description: "Installez Draggy, laissez la configuration choisir un modèle et envoyez votre premier message."
section: start
---

## 1. Installer Draggy

Téléchargez l'installateur pour votre système sur [la page de téléchargement](site:download).

> [!PLATFORMS]
> - Windows: Windows peut afficher un avertissement SmartScreen au premier lancement, car la build n'est pas encore signée avec un certificat de développeur. Sélectionnez Informations complémentaires, puis Exécuter quand même.
> - macOS: Décompressez le `.zip` universel et placez Draggy dans Applications. Au premier lancement, passez par Réglages système → Confidentialité et sécurité → Ouvrir quand même.
> - Linux: Installez le .deb avec `sudo apt install ./fichier.deb`, ou le .rpm avec `sudo dnf install ./fichier.rpm`. L'AppImage se lance après `chmod +x`.

[Installation](doc:installation) détaille toutes les étapes.

## 2. Laisser la configuration choisir un modèle

Au premier lancement, la configuration choisit un modèle adapté à votre matériel et vous demande de le confirmer. Le téléchargement démarre quand vous continuez. Il vient de Hugging Face, et le premier modèle pèse entre 0,5 Go et 240 Go environ selon votre matériel. [Choisir un modèle](doc:models) explique ce choix et liste les modèles pour chaque taille de carte graphique.

## 3. Envoyer un message

Écrivez dans la zone de saisie du côté Chat et envoyez. Draggy charge le modèle en mémoire à l'envoi du premier message, donc la première réponse prend plus de temps que les suivantes. La réponse est produite sur cet ordinateur.

## 4. Ouvrir un projet dans Code

Pour travailler sur des fichiers, passez dans Code avec <kbd>Ctrl</kbd>+<kbd>Maj</kbd>+<kbd>X</kbd> et donnez-lui un dossier de [projet](doc:projects). Dans le mode par défaut, il demande avant de lancer une commande, et chaque modification peut être annulée. [Permissions](doc:permissions) décrit les modes.

## Et ensuite

- [Chat et Code](doc:chat-and-code) couvre les deux côtés de l'application.
- [Fournisseurs](doc:providers) montre comment ajouter ChatGPT, Claude ou un serveur local.
- [Dépannage](doc:troubleshooting) aide quand un modèle ne se charge pas ou qu'un téléchargement reste bloqué.
