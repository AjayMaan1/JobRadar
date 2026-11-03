# prefsvc

Generated 2026-11-02T06:12:31.100Z · 4 tests · **4 passed** · 0 failed · 0 skipped · 1816 ms


## packages/prefs/src/services/services.test.ts

- ✅ PreferencesService › seeds the owner from the legacy env, keeps history, reverts, and applies presets without moving home (120 ms)
- ✅ EvalService › evaluates a job for every active user with their own tiers, and re-evaluation is idempotent per version (202 ms)
- ✅ EvalService › derives facts for pre-v5 jobs without a facts row and previews without writing (10 ms)
- ✅ CrawlScopeService (union of users) › computes excluded HQs as the intersection, the lowest pay floor in USD, metros as the union; single-user auto-applies Workday scopes (12 ms)
