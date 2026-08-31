# 💾 QatlIA — Archives historiques d'exécutions (Saved Runs)

> ⚠️ **Archive historique — ne pas citer comme preuve.**
> **Historical archive — not evidence.**
>
> Ce dossier conserve des **entrées** de découpe extraites de fiches manuscrites,
> ainsi que des **résultats périmés** produits par une version antérieure de
> l'optimiseur, avec d'autres paramètres et sans méthodologie publiée. Les
> chiffres de sortie archivés ici ne sont pas reproductibles et ne doivent servir
> ni de référence produit, ni d'argument commercial.
>
> Les résultats mesurés et reproductibles sont publiés dans
> [`docs/optimizer-benchmark.md`](../docs/optimizer-benchmark.md), à partir des
> fixtures figées de `tests/fixtures/benchmarks/` :
>
> ```bash
> npm run benchmark:optimizer
> ```

---

## 📁 Fichiers disponibles

1. **`test_runs.json`** — entrées complètes (panneaux, options de coupe, listes de pièces). Toujours valides : ce sont des données d'entrée, pas des résultats.
2. **`test_runs_with_results.json`** — mêmes entrées associées à des schémas de coupe **calculés par une version antérieure de l'optimiseur**. Sortie périmée, conservée à titre d'archive uniquement.

---

## 📊 Récapitulatif des runs archivés

### 1. `run_01_somfy_notes_mdf` — fiche manuscrite « Somfy My Notes » (cuisine / dressing MDF)

* **Image source :** scan d'un carnet manuscrit, 21 lignes de cotes.
* **Entrée archivée :** panneau MDF 280 × 207 cm • kerf 3 mm • fil du bois verrouillé.
* **Volume vérifiable :** **21 lignes source** développées en **135 pièces** (somme des quantités du fichier `test_runs.json`).
* **Résultats :** voir `docs/optimizer-benchmark.md`. Ces 21 lignes sont reprises
  telles quelles dans la fixture `tests/fixtures/benchmarks/standard-135.json`,
  mesurée sur le panneau de référence 278 × 208 cm. Les chiffres de sortie
  archivés dans `test_runs_with_results.json` correspondent à d'autres
  paramètres et ne sont pas repris ici.

### 2. `run_02_glass_bonding_6mm` — débit industriel « GLASS BONDING » (verre 6 mm VRSSG6)

* **Document source :** cahier de débit verrier.
* **Entrée archivée :** plaques jumbo verre 321 × 225 cm • kerf 3 mm • marge 0.
* **Volume vérifiable :** **16 lignes source** développées en **52 pièces**.
* **Résultats :** aucun résultat n'est publié pour ce run. Il n'a pas été
  re-mesuré selon la méthodologie de référence (matériau, panneau et marge
  différents), et les chiffres de sortie archivés ne sont pas reproductibles.

---

## Pourquoi les anciens chiffres ont été retirés

Les versions précédentes de ce fichier annonçaient des taux de chute, des
linéaires de coupe et des montants en dirhams qui ne provenaient d'aucune mesure
reproductible, ainsi qu'un total de pièces pour `run_01` qui ne correspondait pas
à la somme des quantités réellement présentes dans `test_runs.json` (135). Toute
affirmation chiffrée sur l'optimiseur doit désormais venir de
`npm run benchmark:optimizer` et être publiée dans `docs/optimizer-benchmark.md`.
