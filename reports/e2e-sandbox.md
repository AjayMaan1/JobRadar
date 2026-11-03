# e2e-sandbox

Generated 2026-11-02T08:51:10.908Z · 16 tests · **16 passed** · 0 failed · 0 skipped · 47036 ms


## tools/sandbox-e2e/e2e.test.ts

- ✅ E2E · v2 pipeline (simulated infra) › 1. dispatcher claims due boards by tier priority and leases them (96 ms)
- ✅ E2E · v2 pipeline (simulated infra) › 2. first poll: engines fetch via gateway, sightings created, jobs enriched + classified (15109 ms)
- ✅ E2E · v2 pipeline (simulated infra) › 3. alerts: P1 + P2 instant, P3/none/internship not; cap of 10 per feed per hour; detail fetched once (1 ms)
- ✅ E2E · v2 pipeline (simulated infra) › 4. dashboard /api/jobs shows eligible classes newest-first, hides none/internships; class filter works (21 ms)
- ✅ E2E · v2 pipeline (simulated infra) › 5. unchanged poll: conditional GET → 304, no enrich, no alerts (2974 ms)
- ✅ E2E · v2 pipeline (simulated infra) › 6. new posting appears → exactly one new alert, time-to-detect recorded (3950 ms)
- ✅ E2E · v2 pipeline (simulated infra) › 7. closure: posting disappears for 2 polls → job closed → hidden from browse, visible in Closed; reappearance reopens without re-alert (13195 ms)
- ✅ E2E · v2 pipeline (simulated infra) › 8. suspect-drop guard: a >50% shrink does not close anything (1 ms)
- ✅ E2E · v2 pipeline (simulated infra) › 9. rate limit: 429 opens the host circuit; next poll is skipped without an HTTP request (9999 ms)
- ✅ E2E · v2 pipeline (simulated infra) › 10. daily digest: P3 + deferred (capped) jobs, excluding instant-alerted ones (6 ms)
- ✅ E2E · v2 pipeline (simulated infra) › 11. aggregator path: apply URL matching a board job dedupes by URL (no new job, no alert) and seeds a discovery (7 ms)
- ✅ E2E · v2 pipeline (simulated infra) › 12. aggregator-only job: created + alerted; liveness closes it on 404 after 14d (20 ms)
- ✅ E2E · v2 pipeline (simulated infra) › 13. tiering derives status/tier from evidence; anchors exempt from dormancy (9 ms)
- ✅ E2E · v2 pipeline (simulated infra) › 14. discovery → resolver (detects embedded Greenhouse board from careers HTML) → probe (no alerts) → watched (762 ms)
- ✅ E2E · v2 pipeline (simulated infra) › 15. retention prunes old fetch_runs and long-gone sightings but never live ones (6 ms)
- ✅ E2E · v2 pipeline (simulated infra) › 16. gateway politeness: honest UA on every request, robots honoured for HTML, budgets tracked (4 ms)
