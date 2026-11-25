---
title: "Installation"
description: "Ce qu'il vous faut, l'avertissement du premier lancement, et comment arrivent les mises à jour."
section: start
---

## Ce qu'il vous faut

Un ordinateur capable d'exécuter des modèles de langage [quantifiés](doc:glossary#quantization). Une carte graphique est facultative. Elle rend en général les réponses plus rapides.

- Windows 10 ou 11 (64 bits), macOS 14 Sonoma ou plus récent (Intel ou Apple silicon), ou Linux 64 bits avec WebKitGTK 4.1, comme Ubuntu 24.04 ou Fedora 40.
- Mémoire : au moins 4 Go (Qwen 3.5 2B). Recommandé : 16 Go (Qwen 3.5 9B).
- Espace disque libre égal à 1,5 fois la taille du modèle : environ 0,8 Go pour le plus petit modèle, 9 Go pour Qwen 3.5 9B.
- Carte graphique : facultative. Recommandé : 8 Go de mémoire vidéo avec au moins 10 Go de mémoire système.

## Installer

Téléchargez le programme d'installation ou le paquet pour votre système d'exploitation sur [la page de téléchargement](site:download) ou sur [la page des versions GitHub](https://github.com/Lucki74/draggy/releases/latest) :

> [!PLATFORMS]
> - Windows: Lancez `draggy_setup.exe`. Il s'installe uniquement pour votre compte utilisateur, dans `%LOCALAPPDATA%\Programs\Draggy`. SmartScreen peut bloquer le programme d'installation, car la build n'est pas encore signée avec un certificat d'éditeur. Sélectionnez Informations complémentaires, puis Exécuter quand même.
> - macOS: Téléchargez le `.zip` universel, qui fonctionne sur les Mac Intel et Apple silicon. Décompressez-le et placez Draggy dans Applications. L'application est signée ad hoc et non notarisée : au premier lancement, passez par Réglages système → Confidentialité et sécurité → Ouvrir quand même. Vous pouvez aussi lancer `xattr -dr com.apple.quarantine /Applications/Draggy.app` dans le Terminal.
> - Linux: Installez le .deb avec `sudo apt install ./fichier.deb`, ou le .rpm avec `sudo dnf install ./fichier.rpm`. Pour l'AppImage, lancez `chmod +x` dessus, puis démarrez-la. Les paquets nécessitent WebKitGTK 4.1.

Chaque version contient un fichier `SHA256SUMS.txt`, si vous préférez vérifier plutôt que faire confiance.

## Le premier lancement

La configuration choisit un modèle adapté à votre matériel et vous demande de le confirmer. Le téléchargement démarre quand vous passez l'étape du modèle, depuis Hugging Face. Le premier modèle pèse entre environ 0,5 Go et 240 Go, selon le matériel.

Quand vous envoyez votre premier message, Draggy charge le modèle en mémoire. Lors des lancements ultérieurs, le modèle reste sur le disque jusqu'à l'envoi d'une invite, donc l'ouverture de l'application est instantanée.

## Mises à jour {#updates}

Windows, macOS et Linux utilisent tous l'updater de Tauri, avec un flux de mises à jour signé. Draggy vérifie au lancement, puis toutes les six heures. Une mise à jour trouvée au lancement s'installe dans la petite fenêtre de démarrage, puis Draggy redémarre sur la nouvelle version. **Démarrer sans mettre à jour** ouvre Draggy tout de suite. Si la vérification ne reçoit pas de réponse en quelques secondes, Draggy démarre quand même. Une mise à jour trouvée plus tard se télécharge en arrière-plan, et un avis **Mise à jour prête** propose **Installer maintenant** ou **Plus tard**. Installer maintenant l'installe discrètement et redémarre Draggy. Il n'existe pas de réglage des mises à jour. Les builds lancées depuis les sources ne se mettent pas à jour.

Pour supprimer Draggy, voyez [Désinstaller](doc:privacy#désinstaller) sur la page confidentialité.
