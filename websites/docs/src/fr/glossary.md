---
title: "Glossaire"
description: "Ce que signifient les termes de ce wiki, et la page qui explique chacun."
section: reference
---

Un terme renvoie à sa définition ici la première fois qu'il apparaît dans le wiki.

### Moteur {#engine}

Le programme qui charge un modèle et écrit ses réponses. Le moteur Draggy exécute des modèles GGUF sur votre ordinateur. Voir [Fournisseurs](doc:local-engines#sur-cet-ordinateur).

### colibri {#colibri}

Le moteur que Draggy utilise pour les grands modèles à mélange d'experts qui ne tiennent pas en mémoire. Il lit des parties du modèle depuis le disque au fur et à mesure, donc il est lent. Voir [Fournisseurs](doc:local-engines#sur-cet-ordinateur).

### Fournisseur {#provider}

Une source de modèles dans Draggy : le moteur intégré, un serveur sur cet ordinateur, un fournisseur cloud avec une clé d'API, ou un abonnement ChatGPT ou Claude. Voir [Fournisseurs](doc:providers).

### GGUF {#gguf}

Le format de fichier des modèles que le moteur Draggy exécute. Un modèle est un fichier `.gguf`, ou plusieurs pour les très grands modèles. Voir [Choisir un modèle](doc:models#parcourir-et-télécharger).

### Quantification {#quantization}

Une façon de stocker les nombres d'un modèle sur moins de bits, ce qui rend le fichier plus petit. `Paramètres → Modèles` liste chaque variante d'un modèle avec la taille de son fichier. Voir [Choisir un modèle](doc:models#parcourir-et-télécharger).

### Fenêtre de contexte {#context-window}

La quantité de texte, comptée en jetons, qu'un modèle peut contenir à la fois. La roue de contexte dans la zone de saisie indique son remplissage. Voir [Chat et Code](doc:chat-and-code#long-conversations).

### Compactage {#compaction}

Replier la partie ancienne d'une longue conversation dans un résumé, pour que la conversation puisse continuer. Cela se produit à la limite de compactage : 70 % de la fenêtre de contexte par défaut, et au plus 64 000 jetons pour les modèles cloud payants, sauf si vous définissez une limite. Voir [Chat et Code](doc:chat-and-code#long-conversations).

### Serveur MCP {#mcp-server}

Un programme qui donne à Draggy des outils supplémentaires, par le Model Context Protocol. `Paramètres → Extensions` les liste. Voir [Extensions et compétences](doc:extensions#what-a-server-is).

### Compétence {#skill}

Un dossier contenant un fichier `SKILL.md` qui apprend au modèle un type de tâche. Le modèle ne lit une compétence que lorsqu'une demande s'y prête, et vous pouvez la lancer en tapant `/` suivi de son nom. Voir [Extensions et compétences](doc:extensions#compétences).

### Modèle d'embedding {#embedding-model}

Un modèle qui transforme du texte en vecteurs, que la bibliothèque utilise pour chercher des documents par le sens. Il ne peut pas tenir une conversation. Voir [Choisir un modèle](doc:models).

### Parler {#talk}

Le mode de conversation vocale de Draggy, dans la barre latérale de Chat. Il écoute, détecte quand vous avez fini, répond à voix haute et vous laisse l'interrompre. Voir [Mode vocal](doc:voice).

### Bac à sable {#sandbox}

Espace restreint dans lequel s'exécutent les commandes. Sous Windows, il ne voit que le dossier du projet, ou presque, et n'a pas de réseau en **Demander d'abord** et **Accepter les modifications**. **YOLO** n'en a pas. Voir [Autorisations](doc:permissions#sandbox).

### Turbo (mode d'autorisation) {#turbo}

Le mode d'autorisation qui modifie, supprime et déplace des fichiers dans le dossier du projet et exécute des commandes dans un bac à sable, sans demander. Il demande avant tout ce qui sort du dossier. Voir [Autorisations](doc:permissions).

### YOLO (mode d'autorisation) {#auto}

Le mode d'autorisation qui modifie les fichiers et exécute les commandes sur tout l'ordinateur, sans demander et sans bac à sable. À réserver aux machines que vous pouvez restaurer. La recherche web a aussi un réglage Automatique, qui ne change pas les autorisations. Voir [Autorisations](doc:permissions).
