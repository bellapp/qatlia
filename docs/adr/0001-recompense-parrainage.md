# 0001 — Récompense du parrainage : 10 % de chaque achat, sans limite

Date : 2026-11-27 — Statut : accepté (décision du fondateur)

## Contexte

QatliA veut que ses clients en amènent d'autres. Un crédit coûte très peu à
produire (environ 0,07 DH d'IA par analyse), donc récompenser en crédits plutôt
qu'en argent coûte peu à QatliA et reste dans le produit. Les packs vendus vont
de 30 crédits (50 DH) à 400 crédits (300 DH). Une partie des clients sont des
ateliers qui vendent des panneaux et peuvent amener des dizaines d'artisans.

## Décision

- Le parrain reçoit en bonus de parrainage **10 % des crédits du pack** de
  chaque achat de son filleul : 3, 8, 20 ou 40 crédits selon le pack.
- Sur **tous** les achats du filleul, **sans limite de durée ni plafond**.
- Le filleul reçoit un bonus de bienvenue de **10 % des crédits du pack** sur
  son premier achat non remboursé (88 crédits au lieu de 80).
- La base des deux bonus est le nombre de crédits du pack, jamais le bonus de
  bienvenue (les 88 ci-dessus ne donnent pas 8,8 au parrain).
- Un seul niveau de parrainage.
- Tout compte peut parrainer dès son inscription, même sans avoir acheté.
- Seuls les achats (carte, paiement manuel validé) déclenchent un bonus. Les
  crédits offerts n'en déclenchent aucun.

## Options écartées

- **100 % des crédits achetés** : message plus fort, mais un client qui se
  parraine avec un second compte obtient chaque pack en double, et un parrain
  actif n'achète plus jamais.
- **Premier achat seulement** : à 10 %, la récompense tombe à 3–40 crédits une
  seule fois, trop peu pour donner envie de parrainer.
- **Durée limitée (12 mois)** : une règle de plus à expliquer et une date à
  suivre par filleul, pour un coût que le prix d'un crédit rend faible.
- **Plafond par mois ou par filleul** : pénalise justement les parrains qui
  amènent le plus de clients payants. Pour recevoir 400 crédits, il faut que
  ses filleuls en achètent 4 000, soit environ 3 000 DH encaissés.
- **Crédits supplémentaires à l'inscription du filleul** : donnés sans
  paiement, ils récompensent aussi les faux comptes.
- **Rien pour le filleul** : il n'aurait aucune raison d'utiliser le lien ou le
  code de son ami, et beaucoup de parrainages réels resteraient non attribués.

## Conséquences

- Se parrainer soi-même avec un second compte ne rapporte que 10 %. C'est le
  garde-fou principal, avec l'interdiction de saisir son propre code, la
  possibilité pour l'admin de détacher un parrainage abusif et le fait que les
  crédits ne se revendent pas.
- Le parrain voit ses filleuls par leur prénom ou nom d'atelier (sinon un
  e-mail masqué), leur état (inscrit ou a acheté) et les crédits qu'il a gagnés
  grâce à eux. Il ne voit ni e-mail complet, ni téléphone, ni montant payé.
- Le parrain apprend ses gains dans le site seulement : ligne dans
  l'historique des crédits, total sur la page Parrainage, bandeau à la visite
  suivante. Aucun e-mail ni message WhatsApp dans ce premier lot.
- **App Android du Play Store** : le parrainage y reste caché tant que Google
  n'a pas accepté la mise en production (demande prévue vers le 2026-12-08),
  car une récompense liée à des achats faits hors Google Play peut faire
  refuser l'app à l'examen. Il y sera affiché dans un second lot, une fois
  l'app validée. D'ici là, un filleul venu par l'app indique son code sur le
  site, au moment d'acheter.
- Les conditions générales doivent dire que le taux peut changer pour les
  achats futurs.
- À trancher dans la spec : l'arrondi des bonus pour un pack dont le nombre de
  crédits n'est pas un multiple de 10 (les quatre packs actuels le sont).
