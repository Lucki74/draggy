---
title: "Choisir un modèle"
description: "Quel modèle convient à votre carte graphique."
section: start
---

[Les modèles d'embedding](doc:glossary#embedding-model) sont listés aussi. Ils transforment le texte en vecteurs pour la bibliothèque, et ils ne peuvent pas tenir une conversation.

## Parcourir et télécharger

`Paramètres → Modèles` liste les 100 modèles GGUF les plus tendance sur Hugging Face, avec une recherche. Cliquez sur un modèle pour déplier ses variantes de quantification. Chacune indique la taille de son fichier.

Cliquez sur le bouton de téléchargement d'une variante. Deux téléchargements tournent à la fois et les autres attendent dans une file, vous pouvez donc en aligner autant que vous voulez. L'icône de téléchargement à droite de la barre de recherche indique dans une pastille rouge combien sont en cours. Cliquez dessus pour voir chacun avec sa progression, son temps restant et un bouton d'annulation. Annuler un téléchargement en cours supprime aussitôt le fichier `.download` partiel, et annuler un téléchargement en attente le retire simplement de la file.

Chaque modèle installé porte des étiquettes : **Chat**, **Code**, **Embedding** ou **Images**. Les modèles d'embedding et d'images ne sont jamais proposés comme modèle de chat. Un modèle que l'app ne sait pas encore exécuter, comme la reconnaissance vocale ou la synthèse vocale, n'apparaît pas dans la liste de téléchargement.

## Chargement en mémoire

Draggy charge un modèle uniquement quand vous envoyez une invite. Pendant que le moteur démarre, la ligne d'état affiche la progression : copie du modèle en mémoire vive ou vidéo, lecture du modèle sur le disque, lecture de l'invite et préparation du moteur.

![Les paramètres Modèles de Draggy avec trois téléchargements en cours : deux actifs avec le temps restant et une barre de progression, un en file d'attente, et une pastille rouge indiquant 3 sur l'icône de téléchargement.](shot:app-settings-downloads)

## Windows et Linux

Draggy choisit le meilleur palier qui tient. Un modèle dense doit tenir dans la mémoire vidéo, et jamais plus de 80 % de la mémoire du système, parce que le moteur lit d'abord tout le modèle en RAM. Une machine qui a moins de 2 Go de mémoire vidéo, comme une machine à graphisme intégré, est traitée comme si elle avait la moitié de sa mémoire système, dans la limite de 8 Go.

| Mémoire vidéo | Modèle dense |
| --- | --- |
| À partir de 1 Go | Qwen 3.5 0.8B |
| À partir de 2 Go | Qwen 3.5 2B |
| À partir de 3,5 Go | Qwen 3.5 4B |
| À partir de 6 Go | Gemma 4 E4B |
| À partir de 7,5 Go | Qwen 3.5 9B |
| À partir de 9,5 Go | Gemma 4 12B |
| À partir de 11 Go | Ministral 3 14B |
| À partir de 15,5 Go | Qwen 3.8 27B, Q3 |
| À partir de 20 Go | Qwen 3.8 27B |
| À partir de 23 Go | Qwen 3.8 27B, Q5 |
| À partir de 32 Go | Qwen 3.8 27B, Q8 |

Un modèle à mélange d'experts (MoE) garde sa partie active sur la carte et le reste en RAM, donc il compte la mémoire vidéo et la RAM ensemble : 90 % de la première plus 80 % de la seconde doivent contenir le fichier.

| Mémoire nécessaire | Modèle MoE |
| --- | --- |
| 14 Go | GPT-OSS 20B |
| 19 Go | Gemma 4 26B |
| 25 Go | Qwen 3.6 35B |
| 40 Go | Qwen 3.6 35B, Q8 |
| 61 Go | Qwen 3.5 122B, Q3 |
| 82 Go | Qwen 3.5 122B |
| 94 Go | Qwen 3.8 Flash-Next, Q3 |
| 116 Go | Qwen 3.8 Flash-Next |
| 135 Go | DeepSeek V4 Flash, Q3 |
| 162 Go | DeepSeek V4 Flash |
| 210 Go | GLM-5.3-Flash |
| 250 Go | GLM-5.3-Flash, Q5 |

Les plus grands demandent aussi une carte d'au moins 8 Go (10 Go à partir de DeepSeek V4 Flash, 12 Go pour GLM-5.3-Flash).

## Apple silicon

Un Mac n'a pas de mémoire vidéo séparée : Draggy utilise 75 % de sa mémoire unifiée et laisse le reste au système. Une puce de base ou Pro prend le modèle de la première colonne. Une Max ou une Ultra, avec beaucoup plus de bande passante mémoire, prend la taille au-dessus quand toute sa mémoire peut la contenir.

| Mémoire unifiée | Base ou Pro | Max ou Ultra |
| --- | --- | --- |
| À partir de 8 Go | Gemma 4 E4B | Qwen 3.5 9B |
| À partir de 16 Go | Ministral 3 14B | GPT-OSS 20B |
| À partir de 24 Go | Qwen 3.8 27B, Q3 | Qwen 3.8 27B, Q3 |
| À partir de 32 Go | Qwen 3.8 27B, Q5 | Qwen 3.8 27B, Q5 |
| À partir de 48 Go | Qwen 3.8 27B, Q8 | Qwen 3.8 27B, Q8 |
| À partir de 96 Go | Qwen 3.8 27B, Q8 | Qwen 3.8 Flash-Next, Q3 |
| À partir de 128 Go | Qwen 3.8 Flash-Next, Q3 | Qwen 3.8 Flash-Next |
| À partir de 192 Go | DeepSeek V4 Flash, Q3 | DeepSeek V4 Flash |

Un Mac à processeur Intel n'est pas un Mac Apple silicon. Draggy dimensionne ses modèles avec les règles de la section Windows et Linux ci-dessus.

## Lire le chiffre GPU

`Paramètres → Modèles` montre, en pourcentage, quelle part de chaque modèle tient sur le GPU. Le vert veut dire que 98 % du modèle ou plus tient. L'orange, de 60 % à 98 %, fonctionne avec une partie sur le processeur, et c'est plus lent. Le rouge, en dessous de 60 %, est une taille trop grande : descendez d'une taille.

Un modèle chargé y gagne un bouton **Décharger**, qui libère la mémoire vidéo sans rien supprimer.

Le bouton corbeille supprime un modèle, même celui qu'un rôle utilise. Ce rôle se rabat alors sur un modèle restant.

## Le modèle vocal

Le [mode vocal](doc:voice) utilise son propre modèle, réglé dans `Paramètres → Chat → [Parler](doc:glossary#talk)`.
