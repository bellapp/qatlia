# Audit QatlIA — Fonctionnalité & Design + Plan d'Implémentation

> **Pour l'exécution :** utiliser Codex CLI (`codex exec`) via la skill `codex` pour implémenter tâche par tâche.
>
> **Référence visuelle :** Design SaaS moderne, non-générique, identité marque forte (atelier menuiserie premium marocain).

**Goal:** Transformer QatlIA d'une app fonctionnelle mais au design "généré par IA" en un outil SaaS premium au design distinctif, mémorable et professionnel.

**Architecture:** Refonte progressive — design d'abord (Design System + composants), puis fonctionnalités manquantes. Next.js 14, Tailwind, Lucide Icons.

**Tech Stack:** Next.js 14, Tailwind CSS, Lucide React, Supabase, TypeScript, jsPDF

---

## 🔴 PARTIE 1 — AUDIT DESIGN (Problèmes)

### 1.1 Design "AI-Generated" — Les 10 signaux

| # | Problème | Localisation | Impact |
|---|---|---|---|
| 1 | Palette monochrome `slate-900` partout — aucune hiérarchie visuelle | `page.tsx`, tous les composants | 🔴 Critique |
| 2 | Pas de Design System : couleurs hardcodées `bg-[#070C18]`, pas de variables cohérentes | `globals.css` (5 tokens inutilisés), `tailwind.config.ts` | 🔴 Critique |
| 3 | Typographie système par défaut — pas de font branding | `layout.tsx` (plus d'import Inter) | 🔴 Critique |
| 4 | Cartes identiques — pas de distinction visuelle entre sections | `PiecesManager.tsx`, `OptionsPanel.tsx` | 🟠 Élevé |
| 5 | Aucune micro-interaction : pas de `transition`, pas d'animation entrée/sortie | Tous les composants | 🟠 Élevé |
| 6 | Icônes Lucide partout, aucun branding visuel personnalisé | Header, boutons | 🟠 Élevé |
| 7 | État vide / erreur / chargement trop basiques ("Prêt pour l'optimisation") | `page.tsx:l891` | 🟡 Moyen |
| 8 | SVG cutting diagram : couleurs plates, pas d'ombres, pas de dégradés | `page.tsx` bloc SVG | 🟡 Moyen |
| 9 | Form inputs : look bootstrap-like, pas de style atelier | Tous les `<input>` | 🟡 Moyen |
| 10 | Pas de responsive design fluide — breakpoints basiques seulement | Layout grid lg:col-span-5/7 | 🟡 Moyen |

### 1.2 Points positifs (à conserver)
- Architecture 2-colonnes lg:grid-cols-12 fonctionnelle
- Composants bien séparés (PiecesManager, OptionsPanel, AccountMenu, AuthModal)
- Palette sombre cohérente pour usage atelier
- `amber-400/500` comme accent — bonne direction
- Logique métier solide (binpacking, PDF, DXF)

---

## 🔴 PARTIE 2 — AUDIT FONCTIONNALITÉ

### 2.1 Bugs & Incohérences

| # | Problème | Gravité |
|---|---|---|
| 1 | Floats non nettoyés : `41.79999923706055` au lieu de `41.8` | 🟠 Élevé |
| 2 | Historique vide si Supabase injoignable — pas de message clair | 🟠 Élevé |
| 3 | Crédits : pas de feedback visuel lors de la déduction | 🟡 Moyen |
| 4 | Auth modal : ferme la modale avant que l'auth Google ne soit complète | 🟡 Moyen |
| 5 | Pas de validation côte serveur pour les dimensions (négatives, zéro) | 🟡 Moyen |
| 6 | CSV export : pas de colonne matériau, pas d'en-tête BOM | 🟢 Faible |
| 7 | Pas de drag & drop pour réorganiser les pièces | 🟢 Faible |
| 8 | Pas de undo/redo | 🟢 Faible |

### 2.2 Fonctionnalités manquantes

| # | Fonctionnalité | Priorité |
|---|---|---|
| 1 | Onboarding first-run (3-step wizard) | 🟠 Élevé |
| 2 | Template de pièces sauvegardables (ex: "Placard Standard") | 🟡 Moyen |
| 3 | Prévisualisation du panneau avant optimisation | 🟡 Moyen |
| 4 | Export DXF fonctionnel (route existe mais non testée) | 🟡 Moyen |
| 5 | Pagination / lazy load pour historique > 50 projets | 🟢 Faible |

---

## 🟢 PARTIE 3 — PLAN D'IMPLÉMENTATION (10 Phases)

### Phase 1 : Design System & Tokens
**Objectif:** Remplacer les couleurs hardcodées par un design system cohérent.

**Fichiers:**
- Modifier: `tailwind.config.ts`
- Modifier: `src/app/globals.css`
- Modifier: `src/app/layout.tsx`

**Tâches:**

#### Task 1.1: Étendre Tailwind avec le Design System QatlIA
```typescript
// tailwind.config.ts — ajouter:
theme: {
  extend: {
    colors: {
      studio: {
        canvas: '#060B14',    // fond principal
        panel: '#0B1424',     // cartes
        field: '#0F1A2E',     // inputs
        border: '#1A2744',    // bordures
        'border-hover': '#243356',
      },
      amber: {
        50: '#FFF8EB', ... 400: '#F5A623', 500: '#E09612', 600: '#C47F0A',
      }
    },
    fontFamily: {
      display: ['"Clash Display"', 'Inter', 'sans-serif'],
      body: ['Inter', 'sans-serif'],
      mono: ['"JetBrains Mono"', 'monospace'],
    }
  }
}
```

#### Task 1.2: Implémenter les variables CSS et fonts Google
- Charger Clash Display + JetBrains Mono depuis Google Fonts
- Appliquer les tokens dans `globals.css` avec `@apply`

#### Task 1.3: Remplacer toutes les couleurs hardcodées
- `bg-[#070C18]` → `bg-studio-canvas`
- `bg-slate-900` → `bg-studio-panel`
- `bg-slate-950` → `bg-studio-field`
- `border-slate-800` → `border-studio-border`
- `text-amber-400` → `text-brand-400`

---

### Phase 2 : Header & Navigation Premium
**Objectif:** Header distinctif avec logo animé, navigation fluide, compte intégré.

**Fichiers:** `src/app/page.tsx` (header section uniquement)

#### Task 2.1: Nouveau logo avec SVG maison (scie circulaire stylisée)
#### Task 2.2: Header glassmorphism avec backdrop-blur-xl
#### Task 2.3: Pills de navigation avec indicateur actif
#### Task 2.4: Badge crédits avec animation pulse

---

### Phase 3 : Hero & Quick Actions
**Objectif:** Zone d'actions rapides visuellement distincte.

**Fichiers:** `src/app/page.tsx` (quick actions section)

#### Task 3.1: Cartes d'action avec illustrations SVG (caméra, fichier)
#### Task 3.2: États hover avec scale + glow
#### Task 3.3: Badge "Vision IA" premium

---

### Phase 4 : PiecesManager Pro
**Objectif:** Liste de pièces au look tableur premium, pas formulaire web.

**Fichiers:** `src/components/PiecesManager.tsx`

#### Task 4.1: Header de table avec libellés fixes (N°, Nom, H, L, Qté, Chants, Actions)
#### Task 4.2: Lignes alternées subtiles (striped)
#### Task 4.3: Fix floats : `Number(p.height.toFixed(1))` déjà fait — vérifier
#### Task 4.4: Animation d'ajout/suppression (framer-motion AnimatePresence)
#### Task 4.5: Quick-add bar flottante en bas (sticky)

---

### Phase 5 : Panneau brut & Options — Refonte
**Objectif:** Section distincte visuellement, pas une carte de plus.

**Fichiers:** `src/components/OptionsPanel.tsx`, `src/app/page.tsx`

#### Task 5.1: Section Panneau avec illustration SVG du panneau
#### Task 5.2: Sliders Kerf custom (pas le range HTML natif)
#### Task 5.3: Toggles avec switch animé (pas checkboxes)

---

### Phase 6 : Visualiseur 2D & Résultats
**Objectif:** Diagramme de coupe digne d'un logiciel pro.

**Fichiers:** `src/app/page.tsx` (results section)

#### Task 6.1: Pièces avec dégradés + bordures nettes + ombres portées
#### Task 6.2: Chutes avec pattern hachuré (pas gris uni)
#### Task 6.3: KPIs en jumbotron avec animations compteur
#### Task 6.4: Navigation panneaux en tabs design

---

### Phase 7 : Onboarding & États vides
**Objectif:** Première expérience mémorable.

**Fichiers:** `src/app/page.tsx`, nouveau composant

#### Task 7.1: Composant EmptyState illustré
#### Task 7.2: Quick-start en 3 étapes (1. Mesures → 2. Photo → 3. Plan)
#### Task 7.3: Exemples de pièces interactifs

---

### Phase 8 : Auth & Account — Polish
**Objectif:** Pages compte et connexion premium.

**Fichiers:** `src/app/auth/login/page.tsx`, `src/app/account/page.tsx`, `src/components/AuthModal.tsx`

#### Task 8.1: Login page : background animé + carte glass
#### Task 8.2: Account page : layout dashboard avec sidebar
#### Task 8.3: AuthModal : animation scale + blur entrée

---

### Phase 9 : Historique — Fiabilisation & UX
**Objectif:** Historique fiable, beau et utile.

**Fichiers:** `src/app/history/page.tsx`, `src/app/api/projects/route.ts`

#### Task 9.1: Fallback localStorage → message "Débits sur cet appareil"
#### Task 9.2: Skeleton loading state
#### Task 9.3: Filtres par date, matériau, nom
#### Task 9.4: Swipe-to-delete sur mobile

---

### Phase 10 : Micro-interactions & Polish Global
**Objectif:** L'application respire le premium.

**Fichiers:** Tous les composants

#### Task 10.1: Page transitions (framer-motion)
#### Task 10.2: Hover states cohérents sur tous les boutons
#### Task 10.3: Toast notifications pour succès/erreur (sonner)
#### Task 10.4: Loading skeletons partout (plus de spinners bruts)

---

## 📁 Fichiers à modifier (ordre)
1. `tailwind.config.ts` — Design System
2. `src/app/globals.css` — Variables + fonts
3. `src/app/layout.tsx` — Fonts + metadata
4. `src/app/page.tsx` — Dashboard (header, actions, panneau, résultats, SVG)
5. `src/components/PiecesManager.tsx` — Liste pièces
6. `src/components/OptionsPanel.tsx` — Options coupe
7. `src/app/history/page.tsx` — Historique
8. `src/app/account/page.tsx` — Compte
9. `src/app/auth/login/page.tsx` — Login
10. `src/components/AuthModal.tsx` — Modale auth
11. `src/components/AccountMenu.tsx` — Menu compte

## ✅ Vérification par phase
- `npm run build` après chaque phase
- Screenshot desktop + mobile
- Test fonctionnel : ajouter pièces → optimiser → exporter PDF

---

## ⚠️ Risques
- `framer-motion` peut alourdir le bundle → lazy-load
- Clash Display est une font payante → fallback sur Inter Display
- Changements CSS globaux peuvent casser des pages non modifiées → vérifier toutes les routes