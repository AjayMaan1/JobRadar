# JobRadar v2 — Implementation notes & runbook

Implements `HLD-jobradar-v2.md` (Phases 0 → C; Phase D items listed at the end). Tests are
deliberately deferred per instruction — see "Before first run" and "Verification checklist".

## Final decisions applied

| Decision | Value |
|---|---|
| P3 | **Hybrid only** in Delhi-NCR at companies tagged `mnc`/`big_tech`/`anchor`. Onsite → `none`. |
| P2 alerts | Instant (`INSTANT_ALERT_CLASSES=p1_global_remote,p2_india_remote`) |
| Alert cap | 10 / feed / hour (`ALERT_CAP_PER_FEED_PER_HOUR`), spillover recorded as `deferred` → digest |
| Anchors | `packages/db/prisma/seeds/anchors.ts` (35 global + 20 NCR); seeded as companies + `manual` discoveries; resolver/prober verify before polling |
| Pay floor | `PAY_FLOOR_INR=3000000`, demotion only at `pay_confidence ≥ 0.6` |
| Workday | Scoped mode only (`query_scope.searchText`), NCR anchors; engine refuses unscoped boards |
| Retention | `fetch_runs` 30d; `job_sightings` 365d after `gone_at`; jobs/notifications kept; closed-job prune off |
| User-Agent | `CONTACT_URL`/`CONTACT_EMAIL` env; neutral default + WARN |

## What changed (by package)

### `packages/db`
- `schema.prisma`: 13 enums, 7 new models (`companies`, `company_boards`, `company_discoveries`, `pay_evidence`, `job_sightings`, `fetch_runs`, `host_policies`); `jobs` gains `company_id, base_score, employment_type, opportunity_class, class_reason, first_seen_at, last_seen_at, closed_at, liveness_checked_at, updated_at`; `sources` gains conditional-GET state + `availability_issue`.
- `migrations/20260601000000_v2_watchlist/migration.sql`: hand-written (no DB in the sandbox) — review before `prisma migrate deploy`.
- `seed.ts`: host policies, anchors, legacy ATS slugs → discoveries; auto-disables the 53 adapter-less Playwright sources and the 5 superseded multi-company ATS sources.

### `packages/crawler`
- `gateway/` — **Fetch Gateway**: host policy resolution (exact → `*.suffix` → `*.html` → `*`), Redis Lua token bucket + concurrency cap + daily/probe budgets, robots.txt for HTML, conditional GET (ETag/Last-Modified/body-hash), response classification (`unchanged|changed|rate_limited|blocked|not_found|error|timeout|skipped`), per-host circuit breaker (429 → Retry-After×2^trips up to 6h; 403/challenge → 6h), `fetch_runs` logging.
- `engines/` — per-board engines: Greenhouse, Lever, Ashby (public posting API), Workable, SmartRecruiters, Recruitee, Teamtailor, Workday (scoped only). `detail()` on Greenhouse/Workable/SmartRecruiters/Workday, fetched once per new sighting.
- `ats-urls.ts` — ATS detection from any URL/HTML, API URL builders, cost classes, URL normalisation.
- `discovery/` — apply-URL extractor, HN Who-is-hiring (Algolia API), GitHub lists (remoteintech, hiring-without-whiteboards, established-remote), YC directory (yc-oss mirror), funding RSS.
- `source-registry.ts` — single adapter registry (web no longer duplicates it); `crawler.service.ts` — cache removed, result-hash short-circuit, failure backoff, throws so BullMQ retries.
- `BaseAdapter.fetchWithRetry` now routes through the gateway (plain fetch fallback only for standalone scripts). Generic adapters' fingerprints no longer include the list index.

### `packages/extractor`
- `classifier.ts` — `classifyOpportunity()` (P1/P2/P3/none with `reason`), `detectEmploymentType()`, NCR city list.
- `normalizer.ts` — `remoteType` removed from canonical hash; `applyUrlNormalized`; `uk`/`asia` substring bugs fixed.
- `dedupe.ts` — URL-normalised match first, hash second; returns `{ job, created, matchedBy }`; reopens closed jobs on re-sighting.
- `extractor.service.ts` — returns class/employment type; accepts company context.

### `packages/ranking`
- Scorers: class band (40/30/15/0) + compensation + role fit + transparency + source/company quality (from DB). Eligibility/timezone/remote-type scorers removed. `base_score` stored; **freshness applied at read time** (`RankingService.displayScore`, mirrored in the web serializer).

### `packages/notifications`
- Instant alerts: created-only, instant classes only, per-feed hourly cap with `deferred` spillover, never recorded as sent when unconfigured. Digest: P1/P2/P3 first seen in 24h, grouped by class. `sendOpsAlert()` for health.

### `packages/watchlist` (new)
`SightingService` (diff + closure + suspect-drop guard), `BoardPollService`, `EnrichService`, `DiscoveryService`, `ResolverService`, `ProberService`, `TieringService`, `DispatcherService` (SKIP LOCKED), `LivenessService` (aggregator-only closure ladder), `RetentionService`, `HealthService`, `PayService`, `CompanyService`.

### `apps/worker`
Queues: `maintenance` (dispatch 30s, probe 5m, resolve 10m, tiering 1h, health 5m, sync-schedules 1h, liveness/retention daily), `poll-board`, `enrich`, `crawl` (one repeatable per enabled source, interval from `refresh_interval_hours`), `discovery` (HN daily, GitHub weekly, YC weekly, funding daily), `notify` (digest 08:00 IST). `direct-crawl.ts` supports `all | boards | resolve`.

### `apps/web`
- `/api/jobs`: `class`, `sort=newest|score`, `includeClosed`, `employmentType`, `company`, case-insensitive search; browse defaults to eligible classes, hides closed and internships/part-time.
- New: `/api/companies` (+ POST add-by-careers-URL, PATCH anchor/manualTier/status), `/api/boards[/id]`, `/api/hosts[/id]` (kill switch, circuit reset), `/api/health`.
- `/api/sources` reads `availability_issue` written by the worker. `/api/crawl` pulls hot/warm boards' `next_poll_at` to now + enqueues source crawls.
- UI: class chips, newest/score sort, closed badge, contract badge, classification panel in the modal, **Watchlist** page, **Health** page, nav.

## Before first run

```bash
pnpm install
pnpm db:generate                 # REQUIRED: generated client in packages/db/generated is stale
pnpm db:migrate                  # dev; or: pnpm db:migrate:deploy
pnpm db:seed                     # sources (with auto-disables) + host policies + anchors + legacy slugs
cp .env.example .env             # set CONTACT_URL / CONTACT_EMAIL, Telegram, SMTP
pnpm typecheck                   # first static verification — expect to iterate here
pnpm worker:dev
pnpm web:dev
```

What happens on first start:
1. `resolve-sweep` (≤10 min) turns anchor + legacy discoveries into `company_boards` (status `probing`).
2. `probe-sweep` (≤5 min, probe budget/host/day) fetches each new board once, enriches with alerts suppressed, sets tier.
3. `dispatch` starts polling due boards every 30s; P1/P2 alerts fire only for sightings created after the probe.
4. Aggregator sources crawl on their own intervals; their apply URLs feed `company_discoveries`.

## Verification — see `docs/VERIFICATION.md`

Sandbox run (migration on real Postgres 16 + 74 unit/regression + 16 E2E scenarios) is green; reports in `./reports`.
Remaining for a full-stack environment:

- [ ] `pnpm typecheck` clean across all packages (generated client must be regenerated first).
- [ ] Migration applies on a fresh DB and on a DB with existing `jobs` rows (`first_seen_at` backfilled from `discovered_at`).
- [ ] Engines: record fixtures for one board per ATS and assert `externalId` stability across two fetches (the false-"new"-storm guard).
- [ ] Gateway: unit-test the Lua token bucket, circuit transitions (429 → open → half-open → closed), challenge-page classification.
- [ ] Sightings: new / seen / missing×2 → gone → job closed; reappearance reopens; suspect-drop suspends closures; aggregator feeds never close.
- [ ] Classifier: table tests for the restriction/India-OK patterns in `classifier.ts`; verify "Remote – India" → P2, "Remote (US)" → none, "hybrid Gurugram" at `mnc` → P3, onsite → none.
- [ ] Anchors: after first probe, check `Watchlist` for boards with `not_found` — ATS slug hints are best-effort and must be corrected there.
- [ ] Workday boards: confirm `query_scope.searchText` returns a small page for each NCR tenant.
- [ ] Alert path end-to-end with a test Telegram chat; confirm cap → `deferred` → digest.

## Known gaps / Phase D

- `custom_json` engine and adapters for Microsoft, Google, Amazon, Amex, Oracle, SAP, Shopify, GitHub (anchors seeded with careers URLs; they sit in `unresolved` until an engine exists).
- Common Crawl bulk seed, LCA dataset ingestion (`pay_evidence.source=lca_dataset`), HN post salary parsing into `pay_evidence`.
- Contractor marketplaces (Braintrust, Contra, Gun.io, Lemon.io) as aggregator sources.
- Playwright browser pool; the two Playwright adapters still launch a browser per crawl.
- LLM extraction is still CLI-subprocess based and effectively unused (deterministic extraction always succeeds); replace with an API call if enrichment quality becomes the bottleneck.
