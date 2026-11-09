# Direction visuelle : registre de banque

Design Read : gestionnaire de mots de passe personnel, un seul utilisateur, usage quotidien sur ordinateur, langage de livre de comptes. Dials ENERGY 1 / RHYTHM 2 / MOTION 1.

## Principes
- Le coffre se lit comme un registre : un index à gauche (fiches classées par lettre), la fiche ouverte à droite, filets fins, aucune ombre, aucun dégradé, aucun verre dépoli.
- Un seul accent, le vert-de-gris, réservé aux actions et à l'état actif. Le rouge (oxyde) ne sert qu'à ce qui détruit des données.
- Aucune icône décorative. Les actions sont des mots.
- Rien ne bouge, sauf un changement de couleur de 80 ms au survol (supprimé si l'utilisateur demande moins d'animations).

## Palette (2 neutres, 1 accent, 1 alerte)
| Rôle | Clair | Sombre | Raison |
|---|---|---|---|
| Papier | `#f3eee2` | `#1a1915` | Fond chaud, évite le blanc clinique et le noir pur |
| Fiche | `#fbf8f0` | `#22211c` | La page ouverte se détache d'un ton |
| Encre | `#1d1a14` | `#ece6d6` | Texte principal (contraste 15:1 / 14:1) |
| Encre atténuée | `#5a5244` | `#a8a08e` | Libellés et détails (6,7:1 / 6,8:1) |
| Vert-de-gris | `#1f5f52` | `#7cbfae` | Seul accent (6,4:1 / 8,3:1) |
| Oxyde | `#8a2b20` | `#e8917f` | Suppression uniquement (7,4:1 / 7,4:1) |

## Typographie
- Titres et noms de sites : empattements (Iowan Old Style, Source Serif 4, Charis SIL, Noto Serif, Georgia). Raison : l'héritage du registre papier.
- Identifiants et mots de passe : monospace système. Raison : chaque caractère doit être lisible sans ambiguïté (0/O, l/1).
- Interface : sans-serif système, pour que les boutons restent neutres.

## Formes
- Rayon unique de 3 px sur les contrôles, 0 sur les panneaux. Raison : coins nets de papeterie, pas de pastilles.
- Filets de 1 px pour séparer, jamais de cartes ni d'ombres.
