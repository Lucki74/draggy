---
title: "Navigateur"
description: "Chercher sur le web, lire des pages et piloter une vraie fenêtre de navigateur."
section: use
---

## Le web et le navigateur

`search_web` lance une requête ; `read_url` récupère une page et en extrait le texte. Les deux n'acceptent que `http` et `https` sur l'internet public, donc on ne peut pas les diriger vers un fichier local. L'outil de navigateur refuse aussi les adresses privées, y compris les noms publics qui pointent vers votre réseau local. <kbd>Ctrl</kbd>+<kbd>Maj</kbd>+<kbd>B</kbd> ouvre le panneau du navigateur.

Pour les sites où il faut cliquer, Draggy pilote une vraie fenêtre de navigateur. Quand l'agent visite une page, le panneau s'ouvre pour l'afficher. Sous Windows, le panneau est une fenêtre WebView2. Son bloqueur de publicités utilise les listes de filtres d'uBlock Origin, EasyList et AdGuard sur le moteur adblock-rust, et vous pouvez désactiver le blocage dans le panneau.

![Une page de test de bloqueur de publicités ouverte dans la fenêtre de navigation de Draggy, avec son score de protection affiché.](shot:app-browser)

Une page derrière un contrôle Cloudflare ou un captcha est signalée comme demandant une personne. Passez-le vous-même dans le navigateur et le modèle pourra lire le site ensuite, parce que vous partagez la même session.
