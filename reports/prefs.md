# prefs

Generated 2026-11-02T06:05:02.418Z · 7 tests · **7 passed** · 0 failed · 0 skipped · 1131 ms


## packages/prefs/src/evaluate.test.ts

- ✅ evaluate × legacy preset reproduces the v1–v4 classifier (golden gate) › same class for every fixture (335 ms)
- ✅ evaluate × legacy preset reproduces the v1–v4 classifier (golden gate) › score components mirror the legacy ranking bands (8 ms)
- ✅ evaluate is per user › a US-only posting is tier1 for a US preset and excluded-by-eligibility for the India preset (2 ms)
- ✅ evaluate is per user › hybrid metros and company tags follow the document (3 ms)
- ✅ evaluate is per user › pay floor and employment type exclusions are explained (25 ms)
- ✅ evaluate is per user › pay bands convert through USD into the user currency (7 ms)
- ✅ evaluate is per user › legacyDocFromEnv honours PAY_FLOOR_INR and INSTANT_ALERT_CLASSES (4 ms)
