# Admin : fiche client pour comprendre un problème — design (court)

Date : 2026-11-25. Validé par le propriétaire dans la conversation (« Ok, implémente »).

## Intention

En tant qu'admin, comprendre ce qu'un client a fait pour démêler une réclamation :
voir la photo de sa fiche, ce qui en a été lu et le plan obtenu, ses dernières
actions, et retrouver un compte par son téléphone. Pouvoir trier les tableaux
de l'admin par date ou par nombre.

## Objectifs

1. **Page projet** `/admin/clients/[id]/projets/[projectId]`, ouverte depuis la
   fiche client : photo(s) de la fiche en grand (lien signé de 5 min vers le
   bucket privé `scans`, sinon la vignette marquée « réduite »), la liste des
   pièces au moment du calcul (fiche d'origine ou « ajoutée à la main »),
   le résultat (panneaux, chute, pièces non placées et pourquoi), le dessin de
   chaque panneau, les réglages (panneau, trait de scie, priorité), la date du PDF.
2. **Dernières activités** sur la fiche client : une liste unique, la plus
   récente d'abord, construite à partir de ce que la fiche charge déjà
   (inscription, dernière connexion, mouvements de crédits, plans calculés avec
   lien, PDF, commandes manuelles, actions admin). 100 entrées au plus.
3. **Tri par en-tête** : un clic trie, un second inverse. Liste des clients
   (côté SQL, paginée), tableaux de la fiche client et de la page projet (dans
   le navigateur : tout est déjà chargé), paiements (tri par date, montant,
   crédits).
4. **Téléphone ↔ email** : la liste des clients montre tous les numéros connus
   (note admin, WhatsApp d'origine, « Mon entreprise ») avec leur origine, et la
   recherche trouve un compte par n'importe lequel, quelle que soit l'écriture
   (`06…`, `+212 6…`, `00212…`). La fiche client montre aussi le téléphone de
   l'entreprise.

## Non-objectifs

- Aucun nouvel enregistrement : pas de trace des analyses ratées ni des
  analyses non suivies d'un calcul (décision du propriétaire : « je veux juste
  les projets enregistrés »).
- Le contenu des devis reste masqué (clients et prix du client de l'artisan).
- Pas d'historique des connexions : Supabase ne garde que la dernière.

## Contraintes

- Production en ligne : rien ne doit casser avant l'application de la
  migration 021. Elle garde la signature `(TEXT, TEXT, TEXT, INT, INT)` de
  `admin_client_list` ; les nouveaux tris sont de nouvelles valeurs de
  `p_sort`. Avant 021 un tri inconnu retombe sur « inscription récente » et les
  colonnes téléphone ajoutées sont vides.
- 021 lit `whatsapp_photo_reads` (019) et `ateliers` (020) : elle doit passer
  après elles.
- Le bucket `scans` reste privé : un chemin n'est signé que s'il appartient au
  client de la page (`isOwnScanPath`), jamais mis en cache.

## Approches

Une seule approche raisonnable, présentée et validée : tout est lu de ce qui
existe déjà (`projects.options_json`, `credit_transactions`, `manual_payments`,
`admin_audit_log`, `auth.users`, `ateliers`, `whatsapp_photo_reads`). Écartées :
journaliser chaque analyse (refusé par le propriétaire), un tri entièrement
dans le navigateur pour la liste des clients (elle est paginée côté SQL).

## Laissé au constructeur

Mise en page exacte, couleurs du dessin des panneaux, limites d'affichage
(nombre de panneaux et de pièces dessinés).
