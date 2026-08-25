# 💾 QatlIA — Archives des Exécutions & Fiches de Mesures (Saved Runs)

Ce dossier conserve les données brutes, les fiches de mesures manuscrites extraites par Vision IA et les résultats complets d'optimisation de découpe.

---

## 📁 Fichiers Disponibles :

1. **`test_runs.json`** : Données d'entrées complètes (panneaux, options de coupe et listes de pièces).
2. **`test_runs_with_results.json`** : Entrées associées aux schémas de coupe calculés (taux de chutes, répartition par panneau, linéaire et gains MAD).

---

## 📊 Récapitulatif des Runs Sauvegardés :

### 1. `run_01_somfy_notes_mdf` — Fiche Manuscrite "Somfy My Notes" (Cuisine / Dressing MDF)
* **Image source :** Scan carnet manuscrit 21 lignes de cotes
* **Format Panneau Brut :** MDF 280 × 207 cm • Kerf 3 mm • Trait de scie linéaire traversant
* **Nombre de pièces :** 140 pièces au total (21 cotes différentes)
* **Résultat d'optimisation :**
  * **Nombre de panneaux requis :** 4 panneaux MDF
  * **Surface utile :** 83.5% (Taux de chute : 16.5%)
  * **Linéaire de coupe :** 87.4 m
  * **Économie estimée :** + 1 800 MAD

---

### 2. `run_02_glass_bonding_6mm` — Débit Industriel "GLASS BONDING" (Verre 6mm VRSSG6)
* **Document source :** Cahier de débit verrier 52 pièces
* **Format Panneau Brut :** Plaques Jumbo Verre 3210 × 2250 mm • Kerf 3 mm
* **Nombre de pièces :** 52 pièces verrières
* **Résultat d'optimisation :**
  * **Nombre de panneaux requis :** 8 plaques Jumbo
  * **Surface utile :** 75.0%
  * **Linéaire de coupe :** 102.1 m
  * **Économie estimée :** + 4 290 MAD
