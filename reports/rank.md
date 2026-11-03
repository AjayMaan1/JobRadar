# rank

Generated 2026-11-02T05:22:39.834Z · 9 tests · **9 passed** · 0 failed · 0 skipped · 691 ms


## packages/ranking/src/ranking.test.ts

- ✅ ranking v2 › class band dominates: P1 40 > P2 30 > P3 15 > none 0 (3 ms)
- ✅ ranking v2 › no salary does not block a high score (alerts no longer depend on score) (1 ms)
- ✅ ranking v2 › compensation bands from INR (0 ms)
- ✅ ranking v2 › freshness decays from first_seen_at at read time (1 ms)
- ✅ ranking v2 › quality maps 0..100 → 0..5 with a default of 50 (1 ms)
- ✅ role fit from profile (C5-7) › uses profile skills/titles when given, RANKING_CONFIG otherwise (1 ms)
- ✅ role fit from profile (C5-7) › falls back to RANKING_CONFIG when no profile row exists (0 ms)
- ✅ role fit from profile (C5-7) › single user: the profile drives the global base score (1 ms)
- ✅ role fit from profile (C5-7) › multi-user (audit NEW-03): no single profile may reorder the shared feed (0 ms)
