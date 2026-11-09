**Français** · [English](README.en.md)

# Coffre

Gestionnaire de mots de passe local pour Helium / Chromium. Tout reste sur ton ordinateur, chiffré.

## Installation
1. Ouvre `chrome://extensions` et active le **Mode développeur**.
2. **Charger l'extension non empaquetée**, puis choisis ce dossier.
3. Clique sur l'icône de Coffre : crée ton mot de passe maître (12 caractères minimum).
   Il ne peut pas être récupéré s'il est perdu.
4. **Importer un CSV** pour reprendre tes mots de passe (format Chrome : `name,url,username,password,note`).
   Supprime ensuite le fichier : il contient les mots de passe en clair.

Après une mise à jour du code, clique sur le bouton de rechargement de Coffre dans `chrome://extensions`
et recharge les pages déjà ouvertes.

## Utilisation
- **Remplir** : sur une page de connexion, une petite clé apparaît dans les champs. Un badge indique le nombre
  d'identifiants du site. Clique sur la clé, puis sur l'identifiant voulu.
  Rien n'est rempli sans clic. Le raccourci `Ctrl+Maj+L` ouvre aussi le menu, mais peut être pris par le navigateur
  (à régler dans `chrome://extensions/shortcuts`).
- **Enregistrer** : après une connexion avec un nouveau mot de passe, une fenêtre en haut à droite propose
  **Ajouter** (ou **Mettre à jour** si le mot de passe a changé). **Jamais** désactive la proposition pour ce site.
- **Gérer** : l'icône de la barre d'outils ouvre le coffre. À gauche l'index des fiches par lettre avec recherche
  (`/` pour y aller, `↓` `↑` pour parcourir), à droite la fiche ouverte : copier, afficher, modifier, supprimer.
  Direction visuelle et raisons des choix : `DESIGN.md`.
- **Verrouillage** : par défaut, une fois le mot de passe maître saisi, le coffre **reste déverrouillé jusqu'à ce que tu
  cliques sur Verrouiller**, même après un redémarrage du navigateur. Une case à l'ouverture et dans les réglages permet
  de désactiver ce mode ; le coffre se verrouille alors à la fermeture du navigateur ou après un délai (5 min, 15 min, 1 h).
- **Réglages** : mode de verrouillage, changement du mot de passe maître,
  sauvegarde / restauration chiffrées, export CSV, liste des sites ignorés.

## Sécurité
- Clé dérivée du mot de passe maître par PBKDF2-SHA256 (600 000 itérations), chiffrement AES-256-GCM.
- Le coffre chiffré est dans le stockage local de l'extension. En mode « rester déverrouillé » (par défaut), la clé de
  chiffrement est aussi gardée **sur le disque** (`storage.local`, clé `keptKey`) : quiconque accède à ton profil de
  navigateur peut alors lire le coffre sans mot de passe. Le bouton Verrouiller l'efface. Sans ce mode, la clé n'est
  qu'**en mémoire** (`storage.session`) : effacée à la fermeture du navigateur et après le délai de verrouillage.
- Un identifiant n'est transmis à une page que si le site correspond (domaine de base, sans confondre les
  hébergements partagés comme `github.io` ou `pages.dev`) **et** après un vrai clic de l'utilisateur.
  Le script de page n'accepte pas les clics simulés par le site.
- L'interface injectée dans les pages est isolée dans un shadow DOM fermé.
- Une sauvegarde ne contient que le coffre déjà chiffré. Pour la lire il faut le mot de passe maître qui était
  en vigueur à ce moment-là.

## Limites connues
- Projet personnel **non audité**. Pour les comptes les plus sensibles, un gestionnaire éprouvé reste préférable.
- Pas de synchronisation entre appareils.
- Les formulaires placés dans une iframe, ou dans des composants web fermés, ne sont pas pris en charge.
- Les cookies de session ne sont pas gérés.

## Tests
Node 20 ou plus récent, aucune dépendance.

    node test/vault.test.mjs [fichier.csv]   # chiffrement, CSV, correspondance de sites
    node test/flow.test.mjs                  # stockage + service de fond (API chrome simulée)
    node test/browser.test.mjs               # vrai Helium sans fenêtre, vrais clics (HELIUM=/chemin si besoin)

## Licence

[GPL-3.0](LICENSE).
