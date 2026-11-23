# Bouton WhatsApp sur le site — design court

## Pourquoi
Les artisans ont du mal à poser une question depuis le site : il n'y a aucun
moyen de contact. WhatsApp est l'outil qu'ils ouvrent tous les jours et QatliA
y a déjà son numéro et son assistant.

## Approches considérées
- A. Rond flottant partout (se cache au défilement) : visible, mais passe encore
  sur le tableau des pièces et le plan dans l'atelier.
- **B. Selon la page (retenue)** : rond flottant sur les pages publiques, petit
  bouton dans la barre du haut sur les pages de travail.
- C. Barre du haut partout : ne gêne jamais, mais peu vu sur l'accueil.

Qui répond : **le robot d'abord, l'humain quand il reprend la main** (option
choisie). Écartés : l'humain seulement ; `WHATSAPP_BOT_SCOPE=all` (le robot
répondrait aussi aux échanges sans rapport avec QatliA).

## Ce qui est construit
1. **Placement**
   - Rond vert flottant, en bas côté fin de ligne (droite en fr/en, gauche en
     ar), marge de sécurité des téléphones : accueil, `/ar`, inscription,
     connexion, crédits (et succès), compte, pages légales.
   - Pages de travail (atelier, historique, panneaux) : pas de rond flottant ;
     un petit bouton WhatsApp au bout de la barre de navigation commune.
   - Compte : rond flottant (pas de travail à couvrir, en-tête déjà plein sur
     téléphone).
   - Rien dans l'admin. Le rond flottant passe sous les fenêtres (connexion,
     devis, visionneuse de scan) : jamais par-dessus. Il se cache pendant la
     saisie dans un champ (clavier ouvert sur téléphone).
2. **Lien** : `https://wa.me/<numéro>?text=<message>`, vers le numéro du robot
   07 26 26 36 86, inscrit dans le code comme celui du support
   (`BOT_WHATSAPP`, à garder égal à `WHATSAPP_FROM_NUMBER`). Le support
   06 00 93 75 23 garde ses liens (pied de page, menu du compte, paiement,
   devis).
3. **Message pré-rempli** selon la page et la langue du site, terminé par la
   marque « (qatlia.ma) ». Exemples fr : « Bonjour, j'ai une question sur
   QatliA. (qatlia.ma) » ; atelier « Bonjour, j'ai besoin d'aide dans
   l'atelier. (qatlia.ma) » ; crédits « Bonjour, j'ai une question sur l'achat
   de crédits. (qatlia.ma) ». Versions ar (darija) et en.
4. **Robot**
   - Un premier message portant la marque, sans provenance pub, enregistre une
     provenance « site » (`referral = { source: 'site' }`) : le contact
     passe le filtre `scope = 'ads'` pour toute la conversation, comme un
     contact venu de la pub.
   - Il est accueilli comme une arrivée par la pub (accueil + menu ; une
     question tapée en plus est répondue par l'assistant).
   - Langue : celle du message du site (fr et en → fr, ar → darija : le robot ne
     parle que ces deux langues), pas la
     darija imposée aux messages de pub.
   - Les contacts « site » restent séparables des contacts « pub » dans
     l'analyse du tunnel publicitaire.

## Hors périmètre
Chat intégré au site, inscription par téléphone, changement de
`WHATSAPP_BOT_SCOPE`.

## Laissé au constructeur
Le composant exact qui porte le bouton de barre (en-têtes partagés ou par
page), les textes ar/en, le style précis du rond (vert WhatsApp, 56 px).
