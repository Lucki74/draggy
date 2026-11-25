---
title: "Chat et Code"
description: "Deux côtés, chacun avec son historique, son modèle et ses réglages."
section: use
---

<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd> passe de l'un à l'autre.

Rien de réglé d'un côté n'atteint l'autre. Code travaille dans un seul dossier et montre chaque changement sous forme de diff.

|  | Chat | Code |
| --- | --- | --- |
| Conversations | Historique | Sessions, une liste par projet |
| Fichiers | Ce qu'il a écrit pour vous | Le dossier du projet |
| Modèle | Le sien | Le sien, ou celui de Chat |
| Outils | Web, navigateur, documents | Fichiers, commandes, code, git, plans |
| Voix | Parler | Pas ici |

## La zone de saisie

| Contrôle | Ce qu'il fait |
| --- | --- |
| Désactivé / Faible / Moyen / Élevé / Maximum | Combien le modèle réfléchit. Désactivé coupe le raisonnement plutôt que d'en demander moins. |
| Activé / Désactivé | S'il peut chercher sur le web. |
| Nom du modèle | Le modèle qui répond. <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd> ouvre le menu des modèles. |
| Roue de contexte | Le remplissage de la fenêtre. Cliquez pour le détail. |

Tapez `/` pour les commandes : `/new`, `/model`, `/compact`, `/settings`, `/web`, `/think`, `/voice`, `/files`, `/image`, ou toute [compétence](doc:glossary#skill) activée. `/permissions`, `/memory` et `/init` fonctionnent dans Code seulement.

Les images collées ou jointes dans le composeur affichent un aperçu avec suppression rapide avant envoi.

## Questions interactives

Lorsque le modèle a besoin de précisions ou de choix, il affiche des cartes de questions interactives directement dans le fil de discussion (choix unique, choix multiples ou texte libre).

Une barre de session suit la progression des questionnaires en plusieurs parties, avec les commandes suivant, valider et passer.

## Suivre les appels d'outils

Chaque appel d'outil apparaît pendant que le modèle l'écrit, avec son nom et ses arguments sous forme de lignes clé et valeur. L'écriture d'un long fichier défile dans une petite boîte qui suit la dernière ligne. Quand un appel se termine, une ligne discrète indique ce qu'il a donné, par exemple le nombre de résultats ou de lignes. Les appels d'outils en lecture seule s'exécutent en parallèle. À la fin de la réponse, le travail du tour se replie en une seule ligne de résumé, et un clic le rouvre. Les étapes restent dans le chat quand vous le rouvrez.

## File d'attente des messages

Pendant qu'une réponse se génère, écrivez la suite et appuyez sur <kbd>Entrée</kbd> pour l'orienter : la note entre dans la réponse en cours. Appuyez sur <kbd>Ctrl</kbd>+<kbd>Entrée</kbd> pour la mettre en file d'attente pour le tour suivant, ou sur <kbd>Ctrl</kbd>+<kbd>Maj</kbd>+<kbd>Entrée</kbd> pour interrompre et envoyer maintenant. Les messages en file d'attente sont conservés si vous redémarrez l'application. Une note de guidage peut être reprise avec **Reprendre pour modifier** avant le tour suivant, puis modifiée.

## Exporter les discussions

Le menu de session dans la barre latérale vous permet d'exporter une conversation en Markdown (`.md`) ou en HTML autonome (`.html`). L'exportation inclut les étapes de réflexion, l'activité des outils, les diffs de code et les mesures de vitesse.

## Quand une conversation s'allonge {#long-conversations}

Quand une réponse atteint la limite de contexte et que le modèle a de la place, Draggy agrandit automatiquement la fenêtre au palier suivant et continue de générer. À 60 % de ce que le modèle peut retenir, Draggy replie la partie ancienne de la conversation en un résumé, et la conversation continue. Pour les modèles cloud payants, ce point est plafonné à 64 000 tokens, sauf si vous fixez une limite.

`/compact` le fait maintenant. `/compact-limit 20k` déplace le seuil, et `auto` le remet.
