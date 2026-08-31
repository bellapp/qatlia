# Optimizer benchmark fixtures

Every number QatlIA publishes about its optimizer is measured on the fixtures in
this directory. They are checked into the repository on purpose: a clone is
enough to reproduce the published results, with no machine-local cache, no
downloaded dataset and no network access.

```bash
npm run benchmark:optimizer                       # stable JSON report
npm run benchmark:optimizer -- --format=markdown  # the tables in docs/optimizer-benchmark.md
```

The measured results and the full methodology are published in
[`docs/optimizer-benchmark.md`](../../../docs/optimizer-benchmark.md).

## Canonical benchmark parameters

Comparing two cutting plans is only meaningful at identical settings, so every
fixture here is measured under exactly one configuration. `tests/benchmark-fixtures.test.js`
fails if a fixture deviates from it.

| Parameter | Value |
| --- | --- |
| Sheet height (Y) | 278 cm |
| Sheet width (X) | 208 cm |
| Kerf | 0.3 cm (3 mm) |
| Edge margin | 1 cm on all four sides |
| Rotation | allowed on every row |
| Grain direction | not locked (sheet and options both `false`) |
| Material separation (`considerMaterial`) | off |
| Material | MDF |
| Objective (`optimizationPriority`) | `linear_guillotine` |

Height × Width is the workshop convention and all lengths are in centimetres,
the canonical internal unit.

## Fixtures

### `standard-135.json`

* **21 source rows** expanding to **135 pieces**.
* Source: `saved_runs/test_runs.json#run_01_somfy_notes_mdf`, captured
  2026-08-23 — a scanned handwritten 21-line kitchen/dressing MDF measurement
  sheet.
* The piece rows are copied **verbatim** from that saved run;
  `tests/benchmark-fixtures.test.js` asserts row-by-row equality against it.
* Only the sheet and options differ from the saved run, which was executed on a
  280 × 207 cm panel with grain locked. The fixture re-states them as the
  canonical parameters above so all fixtures share one configuration.
* Published ceiling: **≤ 4 sheets, 0 unplaced**.

### `standard-16.json`

* **5 source rows** expanding to **16 pieces**.
* Source: the `loadDataset2BenchmarkInput` helper that was hard-coded inside
  `tests/optimizer-regression.test.js` at commit `3dcde31`, before this task
  moved benchmark input into fixture files. Sheet and options are unchanged
  from that helper.
* Published ceiling: **≤ 2 sheets, 0 unplaced**.

## Rules for changing a fixture

Each fixture is pinned by a SHA-256 digest in `tests/benchmark-fixtures.test.js`.
Editing a fixture in place fails that test, because it would silently
re-baseline numbers already published in the docs. To change one:

1. Bump the fixture's `version`.
2. Update the pinned digest.
3. Re-run `npm run benchmark:optimizer -- --format=markdown` and paste the new
   tables into `docs/optimizer-benchmark.md`. Never hand-edit a published
   figure.

## Fixtures that are not published

The improvement plan sketched a third fixture, at 51 pieces. It is
**not** published, because the source data is not available in this repository:
no checked-in dataset expands to 51 pieces. The nearest saved run,
`run_02_glass_bonding_6mm`, is a different job entirely (52 glass panels on
321 × 225 cm jumbo sheets), so it cannot stand in for it, and no piece may be
invented or removed to reach 51. The fixture will only be added if the real
source list turns up.
