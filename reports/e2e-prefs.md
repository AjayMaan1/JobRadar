# e2e-prefs

Generated 2026-11-02T08:51:12.517Z · 5 tests · **5 passed** · 0 failed · 0 skipped · 1207 ms


## tools/sandbox-e2e/prefs.test.ts

- ✅ E2E · dynamic preferences › 1. owner is seeded from the legacy env; a second user takes the US preset (27 ms)
- ✅ E2E · dynamic preferences › 2. the same postings land in different tiers per user, and alerts fan out per user (109 ms)
- ✅ E2E · dynamic preferences › 3. the inbox is built from evaluations: owner sees j1 only, with the tier label and reasons (4 ms)
- ✅ E2E · dynamic preferences › 4. preview shows the effect of a change without saving; saving re-evaluates only that user (313 ms)
- ✅ E2E · dynamic preferences › 5. company tiering follows the union of users: a US-HQ company is watched for both; no posting matched → dormant (3 ms)
