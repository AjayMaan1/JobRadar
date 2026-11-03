# Company Discovery Engine — Decisions (locked for implementation)

| # | Decision | Value | Implementation note |
|---|---|---|---|
| 1 | Pay floor | `PAY_FLOOR_INR=3000000` (30 LPA ≈ USD 36k, EUR 33k, GBP 28k at static FX) | Stored in INR; evidence converted via existing `currency-converter`. Demotion only when `pay_band_status=below_floor` AND `pay_confidence >= 0.6` (>=3 points or one explicit posted band). |
| 2 | Eligibility scope | Non-India-HQ companies hiring Indian devs remotely | Hard gate (see below). `hq_country = IN` → `status=dormant`, `status_reason=india_hq`. Unknown HQ is allowed. |
| 3 | Workday | **Deferred to Phase D**. Existing NVIDIA source stays as one cold aggregator-style source. | Rationale in design doc §3. |
| 4 | LeetCode comp posts | Skipped | Pay evidence sources: `own_posting`, `hn_post`, `lca_dataset`, `manual`. |
| 5 | User-Agent contact | Env `CONTACT_URL` / `CONTACT_EMAIL`; default `JobRadar/2.0 (personal job-alert tool)` + startup WARN when unset | No fake contact details. |
| 6 | Retention (updated) | `fetch_runs` 30d; `job_sightings` 365d after `gone_at`; jobs + notifications kept | Soft-close via `closed_at`; saved/applied keep history. |
| 7 | P3 scope | **Hybrid only** in Delhi-NCR at MNC/big-tech; onsite is `none` | Locked after review. |
| 8 | P2 alerts | Instant | |
| 9 | Alert cap | 10 / feed / hour, spillover → digest | |
| 10 | Anchors | ~35 global + ~20 NCR (`seeds/anchors.ts`) | Verified by probe before polling. |
| x | Retention (superseded) | `fetch_runs` 30d. `job_sightings`: delete where `gone_at < now() - 180d` (never by `first_seen_at`). `jobs` + `notifications` kept. | Prevents evergreen postings re-alerting as "new". |

## Eligibility hard gate (company level)

A company is `watched` only if ALL hold:
1. `hq_country != 'IN'` (unknown allowed)
2. In the last 180 days, at least one engineering posting with one of:
   - explicit India: `India`, `IN`, `Remote - India`, `Asia`, `APAC`
   - unrestricted: `Worldwide`, `Anywhere`, `Global`, `Remote` with no restriction phrase (US-only, EU-only, must be based in, right to work in, authorised to work in)
   - timezone window compatible with IST: `UTC+3..+8`, `overlap with IST/APAC/EMEA`
3. Not `country_restricted` on ALL eng postings (if every posting is US-only/EU-only → dormant, `status_reason=no_india_eligibility`)

Posting-level eligibility is unchanged (existing `eligibility-detector`); company-level = aggregate of posting-level over 180d.
