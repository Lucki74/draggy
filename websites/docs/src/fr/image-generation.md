---
title: "Génération d'images"
description: "Dessiner des images sur votre ordinateur : la commande, le modèle et la taille."
section: use
---

## Dessiner une image

Tapez `/image` suivi de ce que vous voulez, ou demandez une image dans une conversation. Draggy la dessine sur votre ordinateur avec un moteur d'images local : rien n'est envoyé ailleurs. Un modèle d'image cloud envoie le prompt à ce fournisseur. Dans un [projet](doc:projects), le fichier est enregistré dans `assets/generated`. Hors projet, il va dans vos fichiers créés.

## Obtenir un modèle d'image

Ouvrez **Réglages → Modèles** et téléchargez un modèle d'image comme les autres. Les modèles d'image installés affichent une icône d'image à côté du nom, et la quantification figure dans la ligne en dessous. Un modèle que l'app ne sait pas encore exécuter, comme la reconnaissance vocale ou la synthèse vocale, n'est pas proposé au téléchargement.

## Choisir le modèle et la taille

**Réglages → Modèles → Génération d'images** propose deux réglages :

- **Modèle d'image** : Automatique, ou l'un des modèles d'image installés, ou un modèle d'image cloud d'un fournisseur connecté.
- **Résolution des images** : la taille de chaque image dessinée.

| Format | Tailles |
| --- | --- |
| 1:1 | 512 &times; 512, 768 &times; 768, 1024 &times; 1024 |
| 16:9 | 1024 &times; 576, 1344 &times; 768, 1792 &times; 1024 |
| 9:16 | 576 &times; 1024, 768 &times; 1344, 1024 &times; 1792 |

Le modèle utilisé porte une étiquette jaune **Images** dans la liste installée. Les grandes tailles prennent plus de temps et de mémoire.

## Images dans les réponses

Les réponses affichent les images générées ou trouvées sur le web. Cliquez sur une image pour l'ouvrir dans la visionneuse.
