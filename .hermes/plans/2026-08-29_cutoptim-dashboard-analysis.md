# Analyse CutOptim Dashboard — Août 2026

> **URL :** https://cutoptim.com/app  
> **Compte :** etorona@gmail.com (Free tier — 0/2 runs, guest mode)

---

## 🏗 Architecture & Layout

### Top Bar
- **(guest)** badge + `1/2 (guest)` usage counter + "Free registration" CTA
- **2D PANEL / 1D LINEAR** mode toggle
- **Stats en direct** : Parts: 9 · Yield: 63.9% · Waste: 11.56ft² · 💰 Saved: 32.00 ft²
- **DOWNLOADS** button (dropdown)
- **SHARE & PRINT** button
- **Save** button (registered users)

### Left Sidebar — SETTINGS
- **UNIT** : Imperial (IN) / Metric (MM) toggle — CutOptim gère LES DEUX
- **BLADE KERF** : spinbutton avec tooltip info
- **MORE** : settings supplémentaires (expandable)

### Stock Sheets Section
- **Paste from Excel** : zone de texte "Click here, then Ctrl+V from Excel" avec format `Name | Width | Height | Qty | (Price)`
- **Table** : ★ (star priority), NAME, WIDTH, HEIGHT, ✕
- **Star system** : "Starred sheets are used first by the optimizer"
- **+ SHEET** / **+ Sheet** buttons

### Parts Section
- **Paste from Excel** : `Name | Width | Height | Qty | (Cost) | (Selling price)`
- **Furniture templates** button — TV stand · Bookshelf · Wardrobe · Kitchen base cabinet
- **CSV import** button
- **Table** : ● (ColorWell!), NAME, WIDTH, HEIGHT, QTY, ROT. checkbox, ✕
- **Color picker par pièce** — chaque pièce a sa couleur
- **+ PART** / **+ Part** buttons

### Locked Features (FREE ACCOUNT)
- Offcut inventory — "Reusable material pieces from previous cuts"
- Material inventory — "Save and reuse standard material sizes"

---

## 📊 Results Dashboard

### 6 KPI cards
| UTILIZATION | WASTE | SHEETS | PIECES | CUTS | CUT LENGTH |
|---|---|---|---|---|---|
| 63.9% | 11.56 ft² | 1 | 9/9 | 12 | 35.33 ft |

### Optimization Summary
- **"How this plan was optimized"** — texte explicatif : "Guillotine cutting plan — searched several shelf/column strategies and kept the best layout (edge-to-edge cuts, panel-saw ready). **62 candidate layouts were evaluated.**"
- **Paramètres affichés** : Goal (Min. waste), Blade kerf (0.125in), First cut direction (Auto), Speed vs density (Balanced), Part rotation (Allowed), Min. offcut (4in), Sheet supply (Unlimited)
- **Smart summary** : "1 fewer sheet(s) than a simple layout — 32.00 ft² of material saved · 63.9% utilization · 12 cuts · 35.33 ft Cut length · 2× cutting stages · 3 reusable offcuts (8.77 ft²)"

### Sheet View
- **Progress tracker** : combobox "0 (Not started)" / "1 (Completed)" + ✓ button
- **SVG** : pieces with name + dimensions labels
- **Parts list** with names and dimensions

### Tables
- **Material requirements summary** : NAME, SIZE, QTY, FT²
- **Cut list** : SHEET, ORDER, NAME, SIZE (IN) — ordre de coupe numéroté
- **Waste list** : QTY, SIZE

### PRO Features (locked)
- **CUTTING SEQUENCE** — step-by-step animated cutting visualization
- Offcut inventory
- Material inventory

---

## 🔴 CE QUE QATLIA DOIT AJOUTER (priorisé)

### Priorité 1 — Impact immédiat
| # | Feature | Effort |
|---|---|---|
| 1 | **Paste from Excel** (Ctrl+V) — zone de texte bulk import | 1h |
| 2 | **Demo data button** — remplir automatiquement avec des données d'exemple | 30min |
| 3 | **Cut list table** dans les résultats (ordre de coupe numéroté) | 1h30 |
| 4 | **Optimization summary text** — "X layouts évalués, algorithme guillotine..." | 30min |
| 5 | **Imperial/Metric toggle** (cm ↔ inches) — on est en cm, ajouter inches | 1h |

### Priorité 2 — Différenciation
| # | Feature | Effort |
|---|---|---|
| 6 | **Furniture templates** — TV stand, Bibliothèque, Armoire, Cuisine | 3h |
| 7 | **Color picker par pièce** — chaque pièce a sa couleur dans le SVG | 1h |
| 8 | **Star/priority sheets** — consommer les vieux panneaux d'abord | 1h30 |
| 9 | **Waste list table** dans les résultats | 30min |
| 10 | **Progress tracking** — marquer panneaux comme "En cours" / "Terminé" | 1h |

### Priorité 3 — Premium
| # | Feature | Effort |
|---|---|---|
| 11 | **Cutting sequence** — animation étape par étape | 4h |
| 12 | **Share & Print** — lien partageable du plan | 2h |
| 13 | **AI Chat assistant** — intégré dans l'app | 3h |
| 14 | **Cost per piece + selling price** | 1h30 |

---

## 🟢 CE QUE QATLIA FAIT MIEUX

| Feature | QatlIA | CutOptim |
|---|---|---|
| Design / UI | Studio sombre pro, glassmorphism | Fonctionnel mais utilitaire |
| Vision IA (OCR) | ✅ Scan de fiches manuscrites | ❌ |
| PWA offline | ✅ | ✅ |
| Auth sociale | ✅ Google + Email | ✅ Google + Email |
| Dark/Light | ✅ Toggle | ✅ Toggle |
| Multi-langues | ✅ FR/AR/EN | 🌐 10+ langues |
| Export DXF CNC | ✅ | ✅ |
| Export JSON | ✅ | ❌ |
| Calculateur coût MAD | ✅ | ✅ (en $) |
| Onboarding tour | ✅ 4 étapes | ✅ 9 étapes |
| Edge banding couleur+prix | ✅ | ✅ |
|---|---|---|
| **TOTAL livrées (prioritées CutOptim)** | **9/14** | — |