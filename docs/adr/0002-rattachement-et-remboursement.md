# 0002 — Rattachement avant le premier achat, reprise automatique au remboursement

Date : 2026-11-27 — Statut : accepté (décision du fondateur)

## Contexte

Le parrainage doit fonctionner sur le site comme dans l'app Android, où un lien
se perd quand le filleul installe l'app depuis le Play Store. Il faut aussi
éviter que deux clients existants se déclarent l'un l'autre pour toucher 10 %
sur des achats qu'ils auraient faits de toute façon, et qu'un achat suivi d'un
remboursement laisse un bonus acquis. Aujourd'hui, l'admin ne dispose que d'un
ajustement libre de crédits sur la fiche client ; aucun remboursement n'est
relié à un achat précis.

## Décision

- **Code et lien** : chaque compte a un code de parrainage et un lien qui le
  remplit tout seul. Celui qui installe l'app ou s'inscrit sans le lien tape le
  code à la main. Si un lien a été ouvert et qu'un autre code est saisi, le
  code présent au moment de valider l'emporte.
- **Rattachement** : possible à l'inscription ou plus tard, tant que le compte
  n'a fait **aucun achat**. Les comptes gratuits existants peuvent donc encore
  être parrainés. Après le premier achat, le rattachement ne change plus.
- **Remboursement** : rembourser un achat retire **automatiquement** le bonus de
  parrainage qu'il a donné au parrain et, si c'était le premier achat, le bonus
  de bienvenue du filleul. Le bonus de bienvenue revient alors au prochain
  achat non remboursé.
- **Solde du parrain** : si le parrain a déjà dépensé ces crédits, le retrait
  s'arrête à zéro. Le reste est perdu pour QatliA ; le solde n'est jamais
  négatif.
- **Parrain supprimé** : ses filleuls restent clients, sans parrain.

## Options écartées

- **Rattachement à l'inscription seulement** : celui qui a oublié le code ou
  installé l'app d'abord serait perdu, et aucun compte existant ne pourrait être
  parrainé.
- **Rattachement à tout moment** : deux clients existants pourraient se
  déclarer l'un l'autre pour toucher 10 % sur des achats déjà acquis.
- **Lien seulement** : tout filleul passé par le Play Store ou ayant tapé
  l'adresse lui-même ne serait jamais rattaché.
- **Code seulement** : une saisie obligatoire pour des artisans peu à l'aise
  avec la technique, sans le raccourci du lien.
- **Retrait à la main par l'admin** (option recommandée pendant la discussion,
  non retenue) : rien à construire, mais un oubli laisse le bonus acquis. Le
  fondateur a préféré que rien ne dépende de la mémoire de l'admin.
- **Bonus acquis malgré le remboursement** : permet de faire acheter puis
  rembourser un complice pour garder les 10 %.
- **Solde négatif** : exact au crédit près, mais un artisan qui voit « −5 » sans
  avoir rien fait ne comprendrait pas, et tout le site suppose un solde positif
  ou nul.
- **Retenue sur les gains futurs** : rien n'est perdu, mais il faut un compteur
  de dette par parrain et l'expliquer sur sa page.

## Conséquences

- La fiche client de l'admin a besoin d'une nouvelle action « Rembourser cet
  achat », qui vise un achat précis et retire en une fois les crédits du pack et
  les deux bonus. L'argent, lui, reste rendu hors du site, comme aujourd'hui.
- Chaque bonus doit rester relié à l'achat qui l'a donné, pour pouvoir être
  repris et affiché à côté de cet achat sur la fiche client.
- La fiche client montre le parrain et les filleuls d'un compte, et permet de
  détacher un parrainage abusif.
- Le champ de code se trouve à l'inscription et sur la page d'achat, et
  disparaît dès le premier achat.
