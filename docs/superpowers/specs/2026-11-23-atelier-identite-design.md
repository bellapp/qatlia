# Identité de l'atelier sur les documents imprimés — conception

Date : 2026-11-23
Statut : brouillon, à valider

## Pourquoi

Un artisan qui a son atelier l'a demandé. Il fait des devis à ses propres clients, et tout ce qu'il imprime depuis QatliA (le plan de débit comme le devis) doit porter **le nom et le logo de son atelier**, pas ceux de QatliA. La partie « client » du devis, ce sont les clients de l'atelier : elle reste saisie devis par devis.

Aujourd'hui :

- **Devis** ([QuotationDialog.tsx](../../../src/components/QuotationDialog.tsx)) : les champs société existent (nom, adresse, téléphone, email, ICE, IF — `CompanyIdentitySchema` dans [quotation.ts](../../../src/lib/quotation.ts)). Ils sont gardés dans le `localStorage` du navigateur ([quotation-local-store.ts](../../../src/lib/quotation-local-store.ts)) et, pour un projet enregistré, dans `options_json.quotation.company` de ce projet, relu quand on rouvre le devis de ce projet. Rien n'est gardé au niveau du compte : un nouveau projet sur un autre appareil repart vide. Le logo n'est gardé nulle part : il faut le recharger à chaque devis.
- **Plan de débit** ([export-pdf/route.ts](../../../src/app/api/export-pdf/route.ts), `drawQatliaHeader`) : l'en-tête affiche « QatliA — 2026 » et le slogan QatliA. Il n'y a aucune trace de l'atelier.

## Objectifs

1. L'artisan renseigne **une seule fois** l'identité de son atelier dans **Mon compte** : nom, logo, téléphone, adresse, email, ICE, IF.
2. Ces informations sont gardées **sur le serveur, liées au compte**, et retrouvées sur n'importe quel appareil.
3. Le **plan de débit PDF** affiche l'atelier en en-tête (logo, nom, téléphone). QatliA passe en petit dans le pied de page.
4. Le **devis** se pré-remplit avec l'atelier du compte, logo compris.

## Non-objectifs

- **Pas de carnet de clients.** Les informations du client de l'atelier restent ce qu'elles sont aujourd'hui : saisies dans le devis et gardées dans le projet (`options_json.quotation.client`, côté serveur, avec contrôle du propriétaire), jamais dans un fichier commun. Un carnet de clients réutilisable pourra être un chantier séparé.
- Pas de cachet ni de signature, pas de couleurs personnalisées, pas de choix de mise en page.
- Pas de changement sur le DXF, le JSON ou les images de plan envoyées par le bot WhatsApp.
- Pas d'identité au niveau du projet : il y a un seul atelier par compte.

## Anti-objectifs (échec même si « ça marche »)

- Un compte **sans** atelier renseigné obtient un plan de débit moins bon qu'aujourd'hui. Sans atelier, l'en-tête actuel QatliA reste identique.
- Un logo pas contrôlé, ou trop lourd, atteint jsPDF : la validation actuelle de [quotation-logo.ts](../../../src/lib/exports/quotation-logo.ts) reste la seule porte d'entrée.
- Un nom d'atelier en arabe s'imprime en carrés vides ou à l'envers : il doit passer par `drawContentAwareText` / Amiri comme le reste du PDF.
- L'identité d'un atelier est lisible ou modifiable par un autre compte.
- Un devis déjà en cours d'usage change de comportement pour le client de l'atelier : les champs restent modifiables avant l'export.

## Contraintes

- La production est en ligne avec de vrais clients. La migration ne fait qu'ajouter des choses, et l'application doit continuer de fonctionner avant qu'elle soit appliquée : en cas d'erreur de lecture, on fait comme si le compte n'avait pas d'atelier.
- Trois langues (fr / en / ar) pour tous les nouveaux textes de l'interface et des PDF.
- Le site est surtout utilisé au téléphone par des artisans peu à l'aise avec la technique : des mots simples, une seule action claire.

## Approches envisagées

1. **Une table `ateliers` qui garde l'identité et le logo ensemble** (le logo réduit dans le navigateur à environ 600 px de côté, puis rangé en data URL PNG/JPEG dans une colonne texte). **Retenue par l'utilisateur.** C'est la voie la plus simple : une migration, une route, et le serveur relit tout d'un coup au moment de générer le PDF. On accepte de stocker une petite image dans la base parce qu'il n'y en a qu'une par compte.
2. Les informations dans la base, le logo dans un espace fichiers privé `logos` (comme `scans`). Cette voie grandit mieux si on ajoute d'autres images (cachet, signature), mais elle demande plus de pièces : création de l'espace, lien temporaire pour afficher le logo, nettoyage des anciens fichiers. On la gardera en tête pour le jour où il y aura plusieurs images.
3. Garder tout dans le navigateur, comme aujourd'hui pour le devis. Écartée : un artisan qui change de téléphone perd tout.

## Ce qui a été décidé avec l'utilisateur

- Le plan de débit **et** le devis portent l'identité de l'atelier.
- Sur le plan de débit, l'atelier va **en en-tête** et QatliA passe en **petit pied de page** (« Réalisé avec QatliA · qatlia.ma »). C'est l'option A.
- Le stockage suit l'approche 1.
- Sur le devis, ce n'est plus QatliA qui est présenté comme l'émetteur : c'est l'entreprise, avec « Réalisé avec QatliA » en petit. Les fichiers PDF prennent le nom de l'entreprise.

Croquis du plan de débit (chaque page) :

```
┌──────────────────────────────────────────────────────────────┐
│ [LOGO] MENUISERIE BENALI        PROJET CUISINE      23/11/2026│
│        06 12 34 56 78                               Devise MAD│
└──────────────────────────────────────────────────────────────┘
 ...
                         Page 1/3 · Réalisé avec QatliA · qatlia.ma
```

## Conception

### Données

Migration `020_ateliers.sql` :

```sql
CREATE TABLE IF NOT EXISTS public.ateliers (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  address    TEXT,
  phone      TEXT,
  email      TEXT,
  ice        TEXT,
  tax_id     TEXT,
  logo_data_url TEXT,           -- data:image/(png|jpeg);base64,... ou NULL
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ateliers ENABLE ROW LEVEL SECURITY;
-- Aucune policy client : seules les routes serveur y accèdent, avec la
-- service role et un filtre explicite .eq('user_id', user.id).
```

**Service role obligatoire, sans repli.** Contrairement à `/api/export-quotation` (qui retombe sur le client de session si la service role manque), les accès à `ateliers` n'ont pas de repli : sans policy RLS, le client de session ne lirait rien et l'écriture échouerait en silence. Sans service role configurée : la lecture se comporte comme « pas d'atelier », l'écriture renvoie `SAVE_FAILED`.

`ON DELETE CASCADE` fait disparaître l'atelier quand le compte est supprimé (voir la suppression admin, PR #79). La règle d'accès est la même que pour `scans`.

### Validation (une seule source)

- Les champs texte réutilisent `CompanyIdentitySchema` tel quel.
- Le logo réutilise `LogoDataUrlSchema` (format et longueur) **puis** `validateLogoDataUrl` (contenu réel, poids ≤ 500 Ko, dimensions) **à l'enregistrement**. Le logo est validé une nouvelle fois avant d'être donné à jsPDF, parce que la base n'est pas une source de confiance absolue.

### Route `/api/atelier`

- `GET` renvoie `{ atelier: CompanyIdentity & { logoDataUrl?: string } | null }` pour l'utilisateur connecté, et 401 sans session.
- `PUT` reçoit le même objet, le valide, puis fait un upsert. Un `logoDataUrl: null` supprime le logo. Les erreurs renvoient des codes stables (`INVALID_DATA`, `INVALID_LOGO`, `SAVE_FAILED`), comme ailleurs dans l'application.
- Toutes les lectures et écritures sont limitées au `user.id` de la session. On n'accepte jamais d'identifiant venant du client.

### Mon compte — section « Mon entreprise »

**Libellé à l'écran : « Mon entreprise »** (en : « My business », ar : « مؤسستي », cohérent avec le libellé existant « اسم المؤسسة »), et non « Mon atelier ». « Atelier » désigne déjà l'espace de découpe (`/atelier`, menu « Atelier débitage », lien déjà présent sur la page Mon compte) : des artisans peu à l'aise avec la technique confondraient les deux. La table et la route peuvent garder les noms `ateliers` / `/api/atelier`, que l'artisan ne voit jamais.

Une nouvelle `<section id="entreprise">` dans [account/page.tsx](../../../src/app/(site)/account/page.tsx), placée avant la devise :

- les champs nom (obligatoire), téléphone, adresse, email, ICE, IF ;
- le logo : un bouton pour choisir une image, un aperçu et « Retirer ». Avant l'envoi, l'image est réduite dans le navigateur (canvas) à 600 px maximum sur le plus grand côté, puis réencodée : en PNG si elle a de la transparence, sinon en JPEG de qualité 0,85. Formats acceptés à l'entrée : PNG et JPEG (les mêmes que le devis) ;
- un bouton « Enregistrer » avec une confirmation courte ;
- **reprise de l'existant :** si le compte n'a pas encore d'atelier mais que le `localStorage` du devis contient une société, les champs sont pré-remplis avec, et il ne reste plus qu'à enregistrer.

### Plan de débit

- `/api/export-pdf` lit la session (cookie Supabase). Si l'utilisateur est connecté et qu'un atelier existe, l'en-tête dessine :
  - à gauche : le logo s'il y en a un, tenu dans environ 12 × 12 mm en gardant ses proportions, puis le nom en gras et le téléphone ;
  - au centre et à droite : le nom du projet, la date et la devise, comme aujourd'hui.
- Le numéro de page passe dans le pied de page, avec « Réalisé avec QatliA · qatlia.ma », en petit et en gris, dans les trois langues (`pdf-catalog.ts`).
- **Sans atelier** (pas de session, pas de ligne en base, ou erreur de lecture) : le PDF actuel reste **exactement le même**, numéro de page compris dans l'en-tête, et **sans** nouveau pied de page. Seuls les comptes avec une entreprise voient la nouvelle mise en page, y compris quand ils réexportent un ancien projet depuis l'historique.
- Le corps de la requête ne change pas. Le client n'envoie pas l'atelier : c'est le serveur qui le relit, ce qui évite d'avoir à faire confiance à des données envoyées par le client.

### Devis

- À l'ouverture, `QuotationDialog` appelle `GET /api/atelier`. Si un atelier existe, il remplit `company` et `logoDataUrl` et **remplace** les valeurs du `localStorage`.
- Les champs société et le logo restent modifiables avant l'export, mais pour ce devis seulement. Un lien « Modifier mon entreprise » mène à `/account#entreprise`.
- Si le compte n'a pas encore d'atelier, la société saisie dans le devis est enregistrée dans le compte au premier export réussi (sans le logo, sauf si un logo a été choisi). Ainsi les artisans qui font déjà des devis n'ont rien à ressaisir.
- `/api/export-quotation` reçoit toujours `company` et `logoDataUrl` (le corps de la requête ne change pas). Ce qui change, c'est le bas du devis : `footerNote` (fr / en / ar, [quotation-catalog.ts](../../../src/lib/exports/quotation-catalog.ts)) devient « Devis établi par {nom de l'entreprise} — n'engage l'émetteur que jusqu'à sa date de validité ». En dessous, en petit et en gris, on ajoute « Réalisé avec QatliA · qatlia.ma ». Le nom vient de `company.name`, qui est obligatoire dans le devis : cette règle s'applique donc à tous les devis, même pour un compte sans entreprise enregistrée.

### Noms des fichiers

- Plan de débit : `{Entreprise}_{PROJET}.pdf` quand le compte a une entreprise, sinon `QatliA_{PROJET}.pdf` comme aujourd'hui (`/api/export-pdf`, et le nom donné au téléchargement dans `history/page.tsx`).
- Devis : `{Entreprise}_Devis_{n}.pdf`, où l'entreprise est `company.name` du devis.
- Le nom de l'entreprise passe par le même nettoyage que le numéro de devis (une liste blanche ASCII pour `filename=`, la forme UTF-8 pour `filename*=`), et il est raccourci à une longueur raisonnable.

## Décisions laissées au développeur (signalées comme miennes)

- L'emplacement exact et les tailles de police dans l'en-tête, tant que le croquis est respecté.
- L'ordre de priorité pour la société du devis : **atelier du compte > société gardée dans le projet > localStorage**. C'est mon choix, pour qu'un ancien projet ne remette pas une adresse périmée. Conséquence assumée : dès qu'un compte a une entreprise, la société gardée dans chaque projet n'est plus relue à l'ouverture (elle reste écrite par `/api/export-quotation`, sans changement).
- Le pied de page « Réalisé avec QatliA » n'apparaît que pour les comptes avec une entreprise ; les autres gardent le PDF actuel à l'identique (mon choix, pour respecter l'anti-objectif « aucun recul sans atelier »).
- Le libellé « Mon entreprise » plutôt que « Mon atelier » (mon choix, voir plus haut).
- Le nom de la table (`ateliers`) et de la route (`/api/atelier`), choisis pour coller au vocabulaire de l'application.

## Tests attendus

- La route `/api/atelier` : 401 sans session ; enregistrement puis relecture ; logo invalide refusé (mauvais format, mauvais contenu, trop lourd, dimensions énormes) ; aucune lecture d'un autre compte.
- Plan de débit : sans atelier, la sortie est identique à aujourd'hui (même texte d'en-tête) ; avec atelier, nom et téléphone présents, « Réalisé avec QatliA » en pied de page ; nom en arabe dessiné avec Amiri.
- Devis : préremplissage depuis le compte ; priorité sur le `localStorage` ; enregistrement dans le compte au premier export quand il n'y avait pas encore d'atelier ; le bas du devis nomme l'entreprise et non QatliA (fr / en / ar).
- Noms de fichiers : nom de l'entreprise nettoyé (accents, espaces, caractères arabes, guillemets) ; `QatliA_` gardé pour le plan de débit sans entreprise.
- Catalogues fr / en / ar complets (les tests de catalogue existants).

## Ce qui ne pourra pas être vérifié en local

L'interface connectée (Mon compte, devis) demande une vraie session Supabase. Elle sera testée par des tests unitaires de route et de payload, puis à la main en production après la fusion.
