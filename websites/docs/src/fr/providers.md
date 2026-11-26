---
title: "Fournisseurs"
description: "Les serveurs que vous faites tourner, les fournisseurs cloud avec une clé d'API, et les offres que vous payez déjà."
section: providers
---

Draggy fait tourner des modèles sur cet ordinateur à lui seul. `Paramètres → Fournisseurs` sert à en ajouter d'autres : un serveur que vous faites déjà tourner, un fournisseur cloud avec une clé d'API, ou une offre ChatGPT ou Claude que vous payez déjà. Chacun a son groupe dans cette liste.

## Clés d'API

Appuyez sur **Ajouter un fournisseur** et choisissez-en un : OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, Mistral, Groq, Nebius, Novita, SambaNova, SiliconFlow, OpenRouter et d'autres, ou Custom pour tout serveur compatible OpenAI. **Obtenir une clé** ouvre la page du fournisseur où la créer. Collez-la dans **Clé d'API** et appuyez sur **Tester**.

La clé est chiffrée avant d'être enregistrée. Windows protège la clé de chiffrement avec votre compte utilisateur ; sur macOS et Linux, elle se trouve dans `secrets.key`, dans le dossier de données de Draggy, et ne fonctionne que sur la même machine.

## Comptes

ChatGPT et Claude se connectent au lieu de prendre une clé. Draggy atteint chaque offre par l'outil ou le protocole de l'entreprise : Codex pour ChatGPT et Claude Code pour Claude. La page de connexion s'ouvre dans votre navigateur. Draggy n'a aucun champ de mot de passe pour ces comptes.

Ajouter OpenAI ou Anthropic demande quelle voie vous voulez : **Se connecter avec votre abonnement** ou **Utiliser une clé d'API**.

## Ce qui va où

| Groupe | Où tourne le modèle | Ce que cela coûte |
| --- | --- | --- |
| Sur cet ordinateur | Cet ordinateur | Rien |
| Clés d'API | Les serveurs du fournisseur | Chaque requête, facturée par le fournisseur |
| Comptes | Les serveurs de l'entreprise | Les limites de votre offre |

Ce que chacun envoie, et à qui, est sur la [page confidentialité](doc:privacy).
