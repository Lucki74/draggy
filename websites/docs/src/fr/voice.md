---
title: "Mode vocal"
description: "Parlez-lui, et laissez-le répondre à voix haute."
section: use
---

**Parler**, dans la barre latérale de Chat, est une conversation parlée, pas de la dictée. Il écoute en continu, comprend quand vous avez fini, répond à voix haute, et vous laisse le couper.

Utilisez un casque, pour que le micro ne capte pas sa propre voix.

![Le mode vocal de Draggy, prêt à commencer à écouter.](shot:app-talk)

## Touches

| Touche | Action |
| --- | --- |
| `Échap` | Terminer la conversation |
| `Espace` | Couper ou réactiver le micro |

Utilisez les boutons de l'écran Parler pour passer la réponse ou afficher la transcription.

## Voix

**Basique** utilise les voix que fournit votre système d'exploitation. **Naturelle** est une voix neuronale qui tourne sur votre ordinateur. Elle est téléchargée depuis Hugging Face la première fois, et parle anglais, français et espagnol. La vitesse a quatre paliers : 0,9x, 1x, 1,1x et 1,25x. Le russe garde la voix du système.

**Cloud** envoie le texte de la réponse, et non votre voix, à OpenAI ou Google Gemini, pour que la voix de ce fournisseur puisse la prononcer. Vous acceptez chaque fournisseur au préalable. Si une voix cloud échoue en cours de réponse, une voix locale termine la réponse. Dans les réglages Parler, vous choisissez le modèle et le nom de la voix cloud.

L'écoute tourne sur votre machine, avec Whisper base, ou Moonshine base pour l'anglais. Votre audio n'est pas envoyé.

## Quand ça se passe mal

- **Il se coupe lui-même.** Sa propre voix revient dans le micro. Mettez un casque.
- **Il est lent.** L'écran Parler affiche le temps de réponse en millisecondes. S'il reste élevé, essayez un modèle vocal plus petit.
- **« Détection basique ».** Le détecteur de voix neuronal n'a pas chargé, et un détecteur plus simple est utilisé.
