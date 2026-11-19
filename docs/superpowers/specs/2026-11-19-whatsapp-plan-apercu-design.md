# Lien WhatsApp : le plan de coupe visible avant l'inscription

Date : 2026-11-19 · Statut : approuvé · Suite de `2026-11-19-whatsapp-lecture-photo-design.md`

## Pourquoi
Le lien `/w/<code>` envoyé par le bot ouvre l'atelier avec les pièces, mais sans plan : le visiteur voit « Prêt pour le calepinage » et ne sait pas quoi faire. Le propriétaire veut qu'un curieux **voie son plan** pour avoir envie de s'inscrire.

## Décisions prises avec le propriétaire
- **Non connecté : le plan complet est visible en aperçu gratuit** (panneaux, placement, cotes). PDF, enregistrement et devis demandent un compte.
- **À l'inscription ou à la connexion, le crédit est consommé** :
  - l'atelier lance tout seul l'optimisation normale (même plan, 1 crédit) ;
  - cela ouvre la fenêtre d'analyse de 24 h (ré-optimisations gratuites sur cet appareil) et rend le PDF disponible ;
  - un visiteur **déjà connecté** qui ouvre le lien : même chose, à l'arrivée.
- **Le lien expire au bout de 24 h** (au lieu de 7 jours), pour éviter les accès répétés ; son contenu est effacé à ce moment-là.
- **Approche 1** : le serveur calcule l'aperçu à l'ouverture du lien, à partir des pièces stockées, et le remet à l'atelier déjà calculé. Rejetées :
  - un point d'accès public « plan de ce lien » (une optimisation ouverte sans compte, sans gain) ;
  - un calcul dans le navigateur (n'importe qui pourrait modifier la liste et obtenir des plans gratuits).

## Conception
- **`/w/<code>`** :
  - la page serveur calcule l'aperçu avec `optimizeCutting2D`, sur le panneau du résumé et avec les options par défaut ;
  - le composant client met dans le brouillon de l'atelier les pièces, le panneau, `result` et le marqueur `photoPreview: true` ;
  - l'atelier remet le plan comme un plan rouvert, sans appel à `/api/optimize`.
- **Atelier, travail marqué `photoPreview`** :
  - **connecté** (à l'arrivée) : l'optimisation normale est lancée une fois, toute seule, et le marqueur s'efface ;
  - **non connecté** : bandeau « 📄 Créez votre compte gratuit pour télécharger le PDF et enregistrer votre plan » avec un bouton. Le bouton, le PDF et le devis passent par la reprise existante (`askSignInKeepingWork('optimize')`). Après l'inscription, l'optimisation se lance toute seule, y compris après l'aller-retour par Google (`pending-work`). Le bandeau disparaît après une optimisation réussie.
  - solde à zéro : le message habituel de l'atelier.
- **Expiration** : `expires_at = created_at + 24 h`. Le message « deuxième photo » ne donne plus le lien une fois expiré (déjà le cas).

## Non-objectifs
- Confirmation d'e-mail ouverte dans un autre onglet ou navigateur : le parcours existant (bouton de reprise dans l'autre onglet) s'applique.
- Rouvrir le lien sur un autre appareil dans les 24 h : 1 crédit, comme toute optimisation lancée ailleurs.
- Bloquer la capture d'écran de l'aperçu : accepté (une seule liste par numéro).

## Anti-objectifs
- Une optimisation gratuite pour une liste autre que celle lue par le bot.
- Un plan « officiel » (PDF, devis, enregistrement) sans compte.
- Le plan perdu après une inscription.

## Laissé au constructeur
- Le style du bandeau, dans le langage visuel de l'atelier.
