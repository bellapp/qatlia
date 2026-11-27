# QatliA — glossaire du domaine

Le vocabulaire que le code, les specs, les issues et l'interface emploient.
Un terme absent d'ici est soit inventé (à reconsidérer), soit un manque à
combler. Les règles chiffrées et les choix techniques vivent dans `docs/adr/`.

## Crédits

**Crédit** : l'unité que le client dépense dans QatliA. Une analyse complète
d'une liste de débit coûte un crédit.

**Pack** : une quantité de crédits vendue à un prix fixe, en une seule fois
(pas d'abonnement).

**Achat** : un pack payé par le client, soit par carte, soit par paiement
manuel validé par l'admin. C'est le seul événement qui fait gagner un parrain.
_À éviter_ : « transaction », « recharge » (une recharge peut être un crédit
offert).

**Crédits offerts** : tout crédit ajouté sans achat : crédits gratuits de
l'inscription, ajustement fait par l'admin, bonus de parrainage, bonus de
bienvenue. Des crédits offerts ne sont jamais un achat.

**Remboursement** : l'annulation d'un achat. L'achat remboursé ne compte plus,
et les crédits qu'il a fait gagner sont repris.

## Parrainage

**Parrain** : le compte dont le code de parrainage a été utilisé par un autre
compte. Tout compte peut être parrain, même s'il n'a jamais acheté.
_À éviter_ : « référent », « affilié », « ambassadeur ».

**Filleul** : un compte rattaché à un parrain.
_À éviter_ : « parrainé », « référé », « invité ».

**Code de parrainage** : le code court, propre à chaque compte, qu'un filleul
indique pour se rattacher à son parrain.

**Lien de parrainage** : l'adresse à partager qui porte le code de parrainage
et le remplit à la place du filleul.

**Rattachement** : le lien entre un filleul et son parrain. Il se fait tant que
le filleul n'a fait aucun achat, puis ne change plus.

**Détacher** : l'admin défait un rattachement abusif. Le filleul reste client,
sans parrain.

**Bonus de parrainage** : les crédits que le parrain reçoit à chaque achat de
son filleul.
_À éviter_ : « commission » (rien n'est payé en argent), « referral »,
« cashback ».

**Bonus de bienvenue** : les crédits en plus que le filleul reçoit sur son
premier achat. Ce n'est pas le cadeau d'inscription, que tout compte reçoit.

## Relations

- Un parrain a zéro, un ou plusieurs filleuls ; un filleul a un seul parrain.
- Un seul niveau : le parrain d'un parrain ne gagne rien sur les filleuls de
  son filleul.
- Un compte ne peut pas être son propre filleul.
- Un achat donne au plus un bonus de parrainage, et le premier achat du
  filleul donne en plus son bonus de bienvenue.
- Un remboursement reprend le bonus de parrainage de cet achat, et le bonus de
  bienvenue s'il en avait donné un.

## Ambiguïtés relevées

- « Client » désigne tout compte inscrit ; « client payant », un compte qui a
  au moins un achat non remboursé. La demande d'origine (« un client
  parrainant un autre client payant ») parle donc d'un parrain quelconque et
  d'un filleul qui achète.
