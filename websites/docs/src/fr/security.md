---
title: "Sécurité"
description: "Ce que Draggy peut faire, ce qu'il refuse et comment signaler un problème."
section: fix
---

Cette page rassemble au même endroit les limites et les contrôles de Draggy. Chaque section renvoie à la page qui la traite en entier. Certaines requêtes partent sans que vous les demandiez, comme les vérifications de mise à jour.

## Modes d'autorisation

Chaque appel d'outil passe par une même vérification avant de s'exécuter. Le mode choisi détermine ce qui demande une confirmation en premier.

- **Plan seulement** lit le projet et propose des changements. Il ne modifie rien et n'exécute aucune commande.
- **Demander d'abord** demande avant chaque modification de vos fichiers et avant chaque commande qui n'est pas en lecture seule.
- **Accepter les modifications**, le mode par défaut des nouveaux projets, modifie les fichiers sans demander. Il demande avant les suppressions et les commandes qui ne sont pas en lecture seule.
- **Turbo** modifie, supprime et déplace des fichiers dans le dossier du projet et exécute des commandes dans un bac à sable, sans demander. Il demande avant tout ce qui sort du dossier.
- **YOLO** modifie, supprime et exécute des commandes sur tout l'ordinateur, sans demander et sans bac à sable.

La lecture ne demande jamais, dans aucun mode. Le tableau complet est sur la page [Autorisations](doc:permissions).

## Dossiers et fichiers refusés

Draggy les refuse quel que soit le mode.

- Les dossiers comme `.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`, `.password-store`
- Les fichiers comme `.env`, `id_rsa`, `.pem`, `.pfx`, `.npmrc`, `.netrc`, `.git-credentials`, `credentials`
- Toute lecture de plus de 2 Mo

Les types de fichiers exécutables et de scripts sont refusés lors de la création d'un document ou à l'ouverture d'un fichier. Les scripts et installateurs s'ouvrent dans leur dossier au lieu de s'exécuter. La liste complète est sur la page [Projets](doc:projects#ce-qui-reste-refusé), et [Outils et capacités](doc:tools#créer-des-fichiers) couvre les documents.

## Exécuter du code

Sous Windows, les commandes s'exécutent dans un bac à sable qui n'atteint que le dossier du projet, ou presque. **Demander d'abord** et **Accepter les modifications** mettent le dossier en lecture seule et coupent le réseau ; **Turbo** autorise l'écriture et le réseau. Les variables d'environnement dont le nom ressemble à une clé, un jeton ou un mot de passe sont retirées avant le lancement d'une commande dans le bac à sable. Là où il n'y a pas de bac à sable, et en **YOLO**, les commandes s'exécutent directement sur votre machine, avec votre compte utilisateur. Une sortie de plus de 30 000 caractères est tronquée au milieu. Les pages [Commandes](doc:commands#limites) et [Permissions](doc:permissions) détaillent les limites et les règles d'approbation.

## Serveurs distants et ce qu'ils atteignent

Un serveur MCP est un programme qui donne à Draggy des outils supplémentaires. Un serveur local est installé avec npm dans son propre dossier et tourne directement sur votre ordinateur, sous votre compte, avec les identifiants que vous avez saisis. Les scripts d'installation sont refusés et aucun shell n'est impliqué. Aucun serveur n'est activé par défaut.

Un serveur distant tourne ailleurs et est joint en HTTPS. Les serveurs distants se connectent en OAuth avec PKCE. Un serveur local envoie aussi des requêtes au service avec lequel il travaille, comme GitHub. La page [Confidentialité et données](doc:privacy#ce-qui-atteint-le-réseau) indique où part chaque type de requête, et [Extensions et compétences](doc:extensions#le-catalogue) couvre les serveurs.

## Journaux et diagnostics

**`app.log`** contient les événements, avec les requêtes et les réponses réduites à des empreintes et des longueurs, et les secrets masqués. `debug.log` enregistre la sortie en continu par sa longueur, pas par son texte.

Pour un signalement de bug, utilisez `Paramètres → Diagnostics → Exporter les diagnostics`. Il remplace votre dossier personnel et votre nom d'utilisateur, mais relisez le fichier avant de le partager. Les étapes sont sous [Toujours bloqué](doc:troubleshooting#toujours-bloqué).

## Téléchargements

Téléchargez Draggy uniquement depuis ce site ou depuis la page des versions GitHub. La version Windows n'est pas signée avec un certificat d'éditeur. Chaque version contient un fichier `SHA256SUMS.txt`, et Draggy vérifie chaque mise à jour qu'il télécharge. Le premier lancement est expliqué sur la page [Installation](doc:installation).

## Signaler une vulnérabilité

Utilisez le formulaire de signalement privé de GitHub, plutôt qu'un ticket public. Dites ce que vous avez fait, ce qui s'est passé et ce que vous attendiez. Une preuve de concept, même brouillonne, est bienvenue. Indiquez le numéro de build de Draggy, et votre système d'exploitation si cela compte.

[Signaler une vulnérabilité sur GitHub](https://github.com/Lucki74/draggy/security/advisories/new). La politique complète est dans [SECURITY.md](https://github.com/Lucki74/draggy/blob/main/SECURITY.md).
