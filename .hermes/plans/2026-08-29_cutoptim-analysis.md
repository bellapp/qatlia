# Analyse concurrentielle CutOptim → QatlIA

> **Source :** https://cutoptim.com/app (application complète analysée)
> **Date :** 29 août 2026

---

## 🟢 Ce que CutOptim fait mieux — à adopter

### 1. Mode 1D Linéaire (barres, profilés)
CutOptim a un toggle **2D Panneau / 1D Linéaire** dans la topbar.
- **QatlIA :** uniquement 2D actuellement.
- **À faire :** Ajouter un mode « 1D Barres » pour les profilés aluminium, baguettes, tubes.

### 2. Gestion multi-panneaux en stock
CutOptim permet d'ajouter **plusieurs formats de panneaux bruts** (280×207, 250×125, etc.).
- **QatlIA :** un seul format de panneau.
- **À faire :** Permettre plusieurs panneaux de stock avec dimensions et quantités différentes.

### 3. Chants avec couleur et prix au mètre
CutOptim a un système complet : **type de chant, couleur, prix/mètre linéaire**.
- **QatlIA :** chants G/D/H/B binaires uniquement.
- **À faire :** Ajouter couleur + prix/m pour le calcul du coût total.

### 4. Inventaire des chutes réutilisables
CutOptim maintient un **inventaire des chutes** qui peuvent être réutilisées comme stock.
- **QatlIA :** affiche les chutes mais pas de réutilisation.
- **À faire :** Bouton « Ajouter aux panneaux » sur une chute.

### 5. Formats d'export multiples
CutOptim exporte : **PNG, SVG, CSV, Excel, JSON, PDF**.
- **QatlIA :** PDF, DXF, CSV.
- **À faire :** Ajouter export **PNG** (image du plan) et **JSON** (pour API/intégration).

### 6. PWA — Progressive Web App
CutOptim s'installe comme app desktop, fonctionne **hors ligne**.
- **QatlIA :** pas de PWA.
- **À faire :** Ajouter `manifest.json` + service worker.

### 7. Visite guidée / Tour
CutOptim a un **tour onboarding** (driver.js) qui montre chaque section.
- **QatlIA :** pas de tour.
- **À faire :** Ajouter un tour en 4 étapes avec `driver.js` ou `shepherd.js`.

### 8. Barre de progression TOP
Une barre fine en haut qui s'anime pendant les chargements/optimisations.
- **QatlIA :** spinner local.
- **À faire :** Ajouter une `NProgress`-style bar.

### 9. Tooltips partout
Chaque champ a un `data-tip` qui montre une explication au survol.
- **QatlIA :** pas de tooltips.
- **À faire :** Ajouter des infobulles sur Kerf, Priorité, Mode 1 feuille, etc.

### 10. Multi-langues
CutOptim supporte 10 langues (FR, EN, DE, IT, PL, CS, RO, HU, ES, HR).
- **QatlIA :** français uniquement.
- **À faire :** Ajouter au moins **FR + AR** (marché marocain) + EN.

### 11. Bibliothèque de matériaux
CutOptim a une **material library** préconfigurée avec couleurs.
- **QatlIA :** MDF/Alu/Verre/Contreplaqué uniquement.
- **À faire :** Ajouter mélaminé blanc, chêne, stratifié avec couleurs distinctes.

### 12. Coût total du projet
CutOptim calcule le **coût total** : panneaux + chants + main d'œuvre.
- **QatlIA :** gain MAD estimé uniquement.
- **À faire :** Ajouter un calculateur de coût (surface × prix/m² + chants × prix/m).

---

## 🟢 Ce que QatlIA fait MIEUX que CutOptim

| Fonctionnalité | QatlIA | CutOptim |
|---|---|---|
| Design / UI | ✅ Premium sombre, glassmorphism, identité marque | Gris utilitaire |
| OCR Vision IA | ✅ Scan de fiches manuscrites | ❌ Aucun |
| Auth sociale | ✅ Google OAuth | ✅ Email + Google |
| Crédits & Monétisation | ✅ 5 gratuits, packs Stripe | ✅ Limites usage gratuit |
| Historique cloud | ✅ Supabase + localStorage | ✅ Supabase |
| Export DXF CNC | ✅ Oui | ❌ Non |
| Prix MAD localisé | ✅ Dirham marocain | ❌ Pas de MAD |
| Dark/Light mode | ✅ Toggle natif | ✅ Suit l'OS |

---

## 📋 Plan d'implémentation priorisé

### Priorité 1 — Impact immédiat
1. **PWA** — `manifest.json` + service worker (2h)
2. **Barre de progression top** — NProgress wrapper (30min)
3. **Tooltips** — infobulles sur les options avancées (1h)
4. **Export PNG** — capture du canvas SVG (1h)

### Priorité 2 — Différenciation
5. **Chants avec couleur + prix/m** — enrichir le modèle EdgeBanding (2h)
6. **Inventaire des chutes** — bouton « Réutiliser comme panneau » (1h30)
7. **Bibliothèque matériaux** — 6-8 matériaux prédéfinis avec couleurs (1h)
8. **Coût total du projet** — calculateur dans la section résultats (2h)

### Priorité 3 — Expansion
9. **Mode 1D Barres** — nouveau mode de calcul (4h)
10. **Multi-panneaux en stock** — gestion de plusieurs formats (3h)
11. **Tour onboarding** — driver.js en 4 étapes (2h)
12. **Multi-langues FR/AR/EN** — next-intl (3h)
13. **Export JSON** — endpoint API (1h)

---

## ⏱️ Estimation totale : ~23h de développement