# JobRadar v2 — High-Level Design (for approval)

Status: **awaiting approval** · Companion files: `company-discovery-engine.prisma` (schema), `company-discovery-engine.decisions.md`

---

## 1. Goal

Surface remote engineering opportunities for an India-based developer **within minutes of publication**, prioritised as:

| Priority | Class | Definition | Delivery |
|---|---|---|---|
| 1 | `p1_global_remote` | Non-India-HQ company, remote, no restriction that excludes India (Worldwide / Anywhere / APAC / IST-compatible overlap / contractor-EOR) | Instant alert `[P1]` |
| 2 | `p2_india_remote` | Non-India-HQ company, remote, location explicitly India ("Remote – India") | Instant alert `[P2]` |
| 3 | `p3_ncr_hybrid` | Non-India-HQ MNC, hybrid/onsite, Delhi NCR | Daily digest |
| — | `none` | Everything else | Stored, hidden by default |

Full-time and contract both accepted; internship/part-time excluded. Pay floor 30 LPA (INR-normalised) used for demotion only, never for hard exclusion of a posting.

## 2. Locked decisions

| # | Decision |
|---|---|
| D1 | `PAY_FLOOR_INR = 3,000,000`; demote company only when `pay_confidence ≥ 0.6` |
| D2 | Company gate: `hq_country ≠ IN` (unknown allowed) and ≥ 1 P1/P2/P3 engineering posting in 180 d |
| D3 | Workday: **scoped-query mode only** (`searchText`/facets for NCR), warm tier cap, NCR anchors only. Full-board Workday deferred |
| D4 | LeetCode: skipped. Pay evidence = own postings, HN posts, LCA dataset, manual |
| D5 | User-Agent contact via `CONTACT_URL`/`CONTACT_EMAIL`; neutral default + startup WARN; no fake contact |
| D6 | Retention: `fetch_runs` 30 d; `job_sightings` deleted 365 d after `gone_at` (never by `first_seen_at`); `jobs`, `notifications` kept; optional prune of closed-never-touched jobs after 365 d (off by default) |
| D7 | Closure = soft: `jobs.closed_at` + `status='closed'`; saved/applied rows keep history with a "Closed" badge |
| D8 | Anchors (curated big companies) polled hot, exempt from activity demotion, flagged in health panel if 0 eligible postings in 180 d |
| D9 | P3 includes onsite NCR at MNCs (scored below hybrid), toggle `P3_INCLUDE_ONSITE=true` — *to confirm* |
| D10 | P2 alerts instant — *to confirm* |

## 3. System context

```
                 ┌──────────────────────────────────────────────────────────────────┐
                 │                         UPSTREAM (polled)                         │
                 │  ATS boards: Greenhouse · Lever · Ashby · Workable · SmartRec.    │
                 │  Workday (scoped) · custom_json (Phase D)                          │
                 │  Aggregators: Remotive · RemoteOK · Himalayas · WWR · Arbeitnow… │
                 │  Discovery: HN Who-is-hiring · GitHub lists · YC · Himalayas cos │
                 │             funding RSS · Common Crawl · LCA dataset             │
                 └───────────────▲──────────────────────────────────────────────────┘
                                 │ all egress through FETCH GATEWAY
┌────────────┐        ┌──────────┴───────────┐        ┌──────────────┐      ┌──────────────┐
│  Postgres  │◀──────▶│   WORKER (BullMQ)    │───────▶│   Telegram   │      │   Next.js    │
│  (state)   │        │  discovery · resolve │        │   Email      │      │   web UI     │
│            │◀───────│  probe · poll-board  │        └──────────────┘      │  /api/*      │
└────────────┘        │  enrich · notify     │                              └──────┬───────┘
      ▲               │  tiering · retention │                                     │
      │               └──────────┬───────────┘                                     │
      │                          │ token buckets, circuit state, queues             │
      │               ┌──────────▼───────────┐                                     │
      └───────────────│        Redis         │◀────────────────────────────────────┘
                      └──────────────────────┘
```

## 4. Component architecture

```
┌──────────────────────────────── SLOW PATH: DISCOVERY (daily/weekly, budgeted) ────────────────────────────────┐
│                                                                                                                 │
│  ┌──────────────────┐ ┌──────────────┐ ┌─────────────┐ ┌────────────┐ ┌──────────────┐ ┌─────────────────────┐│
│  │ apply-URL        │ │ HN Who-is-   │ │ GitHub      │ │ YC         │ │ funding RSS  │ │ Common Crawl (qtr)  ││
│  │ extractor (inline│ │ hiring (mo.) │ │ lists (wk)  │ │ directory  │ │ (daily)      │ │ LCA dataset (qtr)   ││
│  │ in aggregator    │ │              │ │             │ │ (wk)       │ │              │ │ anchors.yaml (seed) ││
│  │ crawl)           │ │              │ │             │ │            │ │              │ │                     ││
│  └────────┬─────────┘ └──────┬───────┘ └──────┬──────┘ └─────┬──────┘ └──────┬───────┘ └──────────┬──────────┘│
│           └──────────────────┴────────────────┴──────────────┴───────────────┴────────────────────┘           │
│                                                       ▼                                                         │
│                                        company_discoveries (idempotent upsert)                                  │
│                                                       ▼                                                         │
│                                   ┌──────────────────────────────────┐                                          │
│                                   │ RESOLVER  (queue: resolve)       │ name/domain match → companies            │
│                                   │ detectAts() · apply-URL regex    │ careers URL → company_boards             │
│                                   │ budget: probe_budget_per_day/host│ no ATS → status=unresolved (retry 30d)   │
│                                   └──────────────┬───────────────────┘                                          │
│                                                  ▼  status=probing                                              │
│                                   ┌──────────────────────────────────┐                                          │
│                                   │ PROBER  (queue: probe)           │ first fetch via gateway                  │
│                                   │ → sightings, classify, pay evid. │ → hq check, best_class, offices          │
│                                   │ → tier, status=watched|dormant   │                                          │
│                                   └──────────────────────────────────┘                                          │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────── HOT PATH: POLL → DIFF → ENRICH → ALERT ────────────────────────────────────────┐
│                                                                                                                 │
│  ┌──────────────┐   every 30 s   ┌─────────────────────────────┐   jobId=board:<id>   ┌───────────────────────┐│
│  │  DISPATCHER  │ ─────────────▶ │ SELECT company_boards       │ ───────────────────▶ │ queue: poll-board     ││
│  │              │                │  WHERE enabled AND status=  │                      │ (concurrency 10)      ││
│  │              │                │  'active' AND next_poll_at  │                      └──────────┬────────────┘│
│  │              │                │  <= now() FOR UPDATE SKIP   │                                 │             │
│  │              │                │  LOCKED LIMIT 200           │                                 ▼             │
│  └──────────────┘                └─────────────────────────────┘                      ┌───────────────────────┐│
│                                                                                       │ BOARD ENGINE          ││
│  ┌──────────────┐  per-source schedulers (existing Source rows, cache removed)        │ greenhouse|lever|ashby││
│  │ AGGREGATOR   │ ────────────────────────────────────────────────────────────────▶   │ workable|smartrec|    ││
│  │ CRAWL (queue:│  feed_key=source:<id>                                               │ workday(scoped)|rss   ││
│  │ crawl)       │                                                                     └──────────┬────────────┘│
│  └──────────────┘                                                                                │ list request │
│                                                                                                  ▼              │
│  ┌───────────────────────────────────────────── FETCH GATEWAY ─────────────────────────────────────────────┐   │
│  │ host policy lookup → robots cache → token bucket (Redis Lua) → concurrency cap → conditional headers    │   │
│  │ → fetch → classify (unchanged|changed|rate_limited|blocked|error|timeout) → circuit breaker → fetch_run │   │
│  └──────────────────────────────────────────────────┬───────────────────────────────────────────────────────┘   │
│                                                     ▼                                                           │
│                                   ┌──────────────────────────────────┐                                          │
│                                   │ DIFF against job_sightings       │  new | seen | missing→gone | reappeared  │
│                                   │ (feed_key, external_id)          │  suspect_drop guard                      │
│                                   └──────┬───────────────┬───────────┘                                          │
│                                 new only │               │ all                                                  │
│                                          ▼               ▼                                                      │
│                     ┌────────────────────────────┐  ┌─────────────────────────────────┐                          │
│                     │ ENRICH (queue: enrich)     │  │ board health, company counters, │                          │
│                     │ detail fetch (budgeted,    │  │ closure: all sightings gone →   │                          │
│                     │ once) → extractor →        │  │ jobs.closed_at, status=closed   │                          │
│                     │ classify(P1/P2/P3/none) →  │  └─────────────────────────────────┘                          │
│                     │ employment_type → dedupe → │                                                               │
│                     │ Job upsert {created} →     │                                                               │
│                     │ pay_evidence(own_posting)  │                                                               │
│                     └──────────────┬─────────────┘                                                               │
│                                    ▼                                                                             │
│                     ┌────────────────────────────┐      ┌──────────────────────────────┐                         │
│                     │ SCORE & ROUTE              │ ───▶ │ NOTIFY (queue: notify)       │                         │
│                     │ base_score (class band +   │      │ P1/P2 → instant Telegram     │                         │
│                     │ comp + fit + transparency +│      │ P3 → daily digest            │                         │
│                     │ source quality)            │      │ dedupe on canonical_hash     │                         │
│                     └────────────────────────────┘      └──────────────────────────────┘                         │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────── BACKGROUND ────────────────────────────────────────────────────────────────────┐
│ TIERING (hourly): recompute company.tier/status/best_class/offices from sightings + evidence; anchors exempt    │
│ LIVENESS (daily, budgeted): aggregator-only jobs >14 d → GET apply URL → 404/closed page → close; 60 d age-out  │
│ RETENTION (daily): fetch_runs >30 d; job_sightings gone_at < now-365 d; optional closed-job prune               │
│ METRICS (1 min): per-host req/min, 2xx/304/429/403 %, budget used; per-board time-to-detect; alert thresholds   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## 5. Data model

```
                   ┌──────────────────────┐
                   │   company_discoveries│  where/when seen (unique source+external_ref)
                   └──────────┬───────────┘
                              │ resolves to (nullable)
                              ▼
┌────────────────┐   1     ┌──────────────────────┐   1     ┌──────────────────────┐
│  pay_evidence  │ ◀─────n │      companies       │ ───────n│    company_boards    │ one pollable endpoint
│  (data points) │         │  canonical + derived │         │  schedule + cond-GET │ unique (ats_type, slug)
└────────────────┘         │  state, tier, anchor │         │  state + health      │
                           └──────────┬───────────┘         └──────────┬───────────┘
                                      │ 1                              │ 1
                                      │                                │
                                      ▼ n                              ▼ n
                           ┌──────────────────────┐         ┌──────────────────────┐      ┌──────────────────┐
                           │         jobs         │ ◀─────n │    job_sightings     │      │    fetch_runs    │
                           │  canonical posting   │   1     │  (feed_key, ext_id)  │      │  every request   │
                           │  + opportunity_class │         │  first/last/gone     │      │  (30 d)          │
                           │  + closed_at         │         │  missing_count       │      └──────────────────┘
                           └──────────┬───────────┘         └──────────────────────┘
                                      │                        feed_key = board:<id> | source:<id>
                        ┌─────────────┼─────────────┐         (existing aggregator `sources` share the table)
                        ▼             ▼             ▼
                 applications   notifications   (existing)

┌──────────────────┐
│   host_policies  │  per-host rate limit config + circuit breaker state (runtime buckets in Redis)
└──────────────────┘
```

Key invariants:
- **`jobs.first_seen_at`** = min(`job_sightings.first_seen_at`) across feeds → the honest "newest first" sort and the time-to-detect metric.
- **New** ⇔ no `job_sightings` row for `(feed_key, external_id)`.
- **Closed** ⇔ every sighting of the job has `gone_at` set (ATS feeds) or liveness check failed / aged out (aggregator-only).
- **Company state is derived**, never hand-edited, except `anchor`, `manual_tier`, `notes`.
- **All egress** goes through the gateway; adapters never call `fetch()` directly.

## 6. Key flows

### 6.1 Board poll → diff → alert (hot path)

```
DISPATCHER        POLL-BOARD WORKER        FETCH GATEWAY            UPSTREAM         DB
    │                    │                       │                     │              │
    │ due boards (SKIP   │                       │                     │              │
    │ LOCKED), set       │                       │                     │              │
    │ next_poll_at       │                       │                     │              │
    │───enqueue─────────▶│                       │                     │              │
    │                    │ fetch(list, etag)     │                     │              │
    │                    │──────────────────────▶│ policy, bucket,     │              │
    │                    │                       │ robots, If-None-    │              │
    │                    │                       │ Match ─────────────▶│              │
    │                    │                       │◀─ 304 | 200 body ───│              │
    │                    │                       │ classify, fetch_run ───────────────▶│
    │                    │◀─ {unchanged} ────────│                     │              │
    │                    │  → consecutive_unchanged++ ; done                           │
    │                    │                       │                     │              │
    │                    │◀─ {changed, items[]} ─│                     │              │
    │                    │ load sightings for feed_key ────────────────────────────────▶│
    │                    │ diff: new / seen / missing / reappeared                       │
    │                    │ suspect_drop? (count < 50% prev) → skip closures, flag        │
    │                    │ upsert sightings; missing_count++ ; gone_at when ≥2 ─────────▶│
    │                    │ for each NEW: enqueue enrich(board, external_id, item)        │
    │                    │ closure: jobs with all sightings gone → closed_at ───────────▶│
    │                    │ update board health, company counters ───────────────────────▶│
```

### 6.2 Enrich → classify → score → notify

```
ENRICH WORKER                           GATEWAY        DB             NOTIFY
    │ cheap pre-filter: title regex (existing TITLE_INCLUDE/EXCLUDE)
    │ fail → store sighting only, no Job
    │ pass → detail fetch (once; greenhouse content / lever has it / ashby posting-api)
    │────────────────────────────────────▶│
    │◀───────────────────────────────────│
    │ deterministicExtract (existing) → salary, eligibility phrases, remote_type, seniority
    │ employment_type: full_time|contract|part_time|internship|unknown
    │ classify → P1 | P2 | P3 | none  (+ class_reason)
    │     inputs: company.hq_country, company.tags(mnc/big_tech), location, restriction phrases,
    │             remote_type, NCR city list
    │ normalize → canonical hash (company|title|location_key; remote_type REMOVED)
    │ URL-normalised match first, hash second → {job, created}
    │ Job upsert, company_id, first_seen_at ────────────────────────▶│
    │ pay_evidence(own_posting) if salary parsed ───────────────────▶│
    │ base_score = class band + compensation + role fit + transparency + source quality
    │ if created AND class ∈ {P1,P2} AND employment_type ∉ {internship, part_time}
    │     → enqueue notify(instant, tag=[P1]/[P2]) ─────────────────────────────────▶│
    │ P3 → picked up by daily digest query                                           │
```

### 6.3 Discovery → resolve → probe (slow path)

```
DISCOVERY JOB            RESOLVER                      PROBER                    TIERING
    │ parse source → {name, domain?, careers_url?, ats_hint?, slug_hint?, hq_hint?}
    │ upsert company_discoveries (source, external_ref) ; seen_count++
    │──────────────────────▶│
                            │ match existing company by domain | normalized_name
                            │ none → create company(status=discovered)
                            │ slug_hint → create board directly
                            │ careers_url → detectAts() (1 request, budgeted) → board | unresolved
                            │ status=probing ──────────▶│
                                                        │ first list fetch via gateway (probe budget/host/day)
                                                        │ run diff+enrich for all items (no alerts on probe)
                                                        │ compute hq gate, best_class, offices, engineering_share
                                                        │ pay band from evidence
                                                        │ status = watched | dormant(reason) ; tier ───────▶│
                                                                                                            │ hourly: recompute
                                                                                                            │ tier from activity,
                                                                                                            │ class, pay; anchors
                                                                                                            │ exempt from demotion
```

### 6.4 Closure (ATS feeds vs aggregator-only)

```
ATS board feed (full list each poll)                 Aggregator-only job (windowed feed)
────────────────────────────────────                 ──────────────────────────────────────
absent in successful poll → missing_count++          1. apply URL matches a watched board?
missing_count ≥ 2 → gone_at                             → board sighting is source of truth
all sightings gone → jobs.closed_at, status=closed   2. else age >14 d → liveness GET (budgeted,
reappears → gone_at cleared, closed_at cleared,         ≤1/host/min): 404 / "no longer available" /
  no re-alert (notification dedupe)                     redirect to board root → close; recheck 7 d
guards: failed polls don't count; suspect_drop        3. else 60 d without re-sighting → close
  blocks closures until next poll confirms
```

## 7. Scheduling & tiers

| Tier | Gate | cheap (GH/Lever/Ashby/Workable) | medium (SmartRec/Recruitee) | expensive (Workday scoped/html) |
|---|---|---|---|---|
| hot | best_class=P1 or anchor; pay ≥ floor or unknown; ≥2 eng postings/30 d | 5 min | 15 min | 60 min |
| warm | P1/P2 with activity in 90 d; or P3-only companies (cap) | 30 min | 60 min | 3 h |
| cold | eligible, quiet | 6 h | 12 h | 24 h |
| dormant | no P1/P2/P3 in 180 d, or below floor with confidence ≥ 0.6, or hq=IN | 7 d | 7 d | 14 d |

- `interval_effective = tier_interval × (1 + postings/250)` (big boards) `± 20 % jitter`, phase offset = hash(board_id).
- Dispatcher is DB-driven (`next_poll_at`), not one BullMQ repeatable per board. BullMQ `jobId=board:<id>` prevents stacking.
- Budget at 10 k companies ≈ 3–4 req/s total; at the expected 2–4 k ≈ 1 req/s. Single worker, concurrency 10.

## 8. Fetch Gateway (rate limiting & anti-bot)

| Control | Rule |
|---|---|
| Identity | `JobRadar/2.0 (+CONTACT_URL; mailto:CONTACT_EMAIL)`; no UA rotation, no proxies, no fingerprint spoofing |
| robots.txt | cached per host (24 h); honoured for HTML; ATS JSON APIs in scope |
| Conditional | `If-None-Match` / `If-Modified-Since`; body-hash fallback |
| Token bucket | per-host `min_interval_ms`, `burst`, `max_concurrency` (Redis Lua, atomic); global cap 8 req/s |
| Daily budget | per host (`daily_budget`), alert at 80 %, hard stop at 100 %; separate `probe_budget_per_day` |
| 429 / Retry-After | host circuit open for max(Retry-After, 60 s), exponential on repeat (→ 6 h); all boards on host pause |
| 403 / challenge page (cf-chl, "Just a moment", datadome, _abck, px-captcha) | host circuit open 6 h; board `blocked_count_7d++`; 3 in 7 d → board `blocked` + operator alert; never tight-loop retry |
| 404 | board backoff; `gone` after 30 d |
| 5xx / timeout | board backoff 2^n min (max 6 h); `failing` after 5 |
| Half-open | single probe after `circuit_open_until`; success closes, failure reopens at 2× |
| Detail fetches | only for new sightings, once, after cheap title filter; separate budget |
| Kill switch | `host_policies.enabled=false` stops all traffic to a host immediately |

Default host policies:

| Host | min interval | conc. | burst | daily |
|---|---|---|---|---|
| boards-api.greenhouse.io | 1 000 ms | 2 | 3 | 20 000 |
| api.lever.co | 1 000 ms | 2 | 3 | 20 000 |
| api.ashbyhq.com | 2 000 ms | 1 | 2 | 10 000 |
| apply.workable.com | 2 000 ms | 1 | 2 | 10 000 |
| api.smartrecruiters.com | 1 000 ms | 2 | 3 | 10 000 |
| *.myworkdayjobs.com (per tenant) | 5 000 ms | 1 | 1 | 500 / tenant, 5 000 global |
| aggregator hosts | 2 000 ms | 1 | 1 | 2 000 |
| any HTML host | 60 000 ms | 1 | 1 | 200 |

## 9. Classification & scoring

**Classifier inputs:** `company.hq_country`, `company.tags`, posting `location`, restriction phrases (existing `COUNTRY_RESTRICTED` + EU-only / "based in" / "right to work"), positive phrases (existing `WORLDWIDE_POSITIVE`, `INDIA_POSITIVE`, `APAC_POSITIVE` + EOR/contractor: "Deel", "Remote.com", "Oyster", "contractor, any country", "4h overlap with CET/IST"), `remote_type`, NCR city list.

```
if hq_country == IN                                  → none (reason: india_hq)
if remote and location ~ India                       → P2
if remote and restricted (US/EU/UK-only, based-in…)  → none (reason: <phrase>)
if remote and (worldwide|anywhere|APAC|overlap|EOR|no restriction phrase) → P1
if (hybrid|onsite) and city ∈ NCR and tags ∩ {mnc, big_tech} → P3 (onsite scored −5 if P3_INCLUDE_ONSITE)
else                                                 → none
```

**Base score** (stored; freshness applied at read time):

| Component | Max |
|---|---|
| Class band: P1 40 · P2 30 · P3 15 · none 0 | 40 |
| Compensation (existing INR bands) | 30 |
| Role fit (existing skills/category/seniority) | 15 |
| Salary transparency | 5 |
| Source/company quality (`companies.quality_score` or `sources.quality_score`) | 5 |
| **Freshness (read time, from `first_seen_at`)** | 10 |

Removed: `eligibility.scorer`, `timezone.scorer`, `remote-type.scorer` (all subsumed by class). Feed default: `WHERE status IN (new,saved) AND closed_at IS NULL ORDER BY class, first_seen_at DESC`.

**Alerting:** trigger = `created` ∧ class ∈ {P1, P2} ∧ employment_type ∉ {internship, part_time}. No score threshold. P3 → digest. Dedupe on `canonical_hash` per channel (existing). Alert text includes class tag, company, title, location, salary if known, `class_reason`, apply URL.

## 10. Web / API changes

| Area | Change |
|---|---|
| `/api/jobs` | `class` filter, `sort=newest` (`first_seen_at`), `company` filter, `includeClosed`, case-insensitive search |
| `/api/companies` (new) | list/search watchlist; tier, status, best_class, pay band, anchor toggle, manual_tier |
| `/api/boards/:id` (new) | health, last fetch runs, circuit state; `enabled` toggle |
| `/api/hosts` (new) | host policies + circuit state; kill switch |
| `/api/sources` | single adapter registry (remove duplicated `SUPPORTED_DOMAINS`) |
| UI | class chips (P1/P2/P3) · "Closed" badge on saved/applied · Watchlist page · Health page (boards, hosts, time-to-detect, blocked alerts) · "Refresh" button enqueues *due-now* for hot boards instead of crawl-all |

## 11. Observability

- Per host: req/min, 2xx / 304 / 429 / 403 ratio, p95 latency, daily budget used, circuit state.
- Per board: last success, consecutive failures/unchanged, postings, new/24 h, `suspect_drop`.
- Per company: time-to-detect = median(`first_seen_at − posted_at_src`) — the early-mover KPI.
- Alerts (Telegram ops channel): any `blocked`; 429 ratio > 1 % / 15 min; budget > 80 %; dispatcher lag > 2 min; zero new jobs across all hot boards for 6 h.

## 12. Rollout

| Phase | Scope | Exit criteria |
|---|---|---|
| **0** (≈3 d) | Per-source schedulers; remove 8 h cache; `{created}` flag; alert gating; BullMQ hygiene | Aggregator jobs visible < 1 h after publish |
| **A** (≈1.5 wk) | Schema migration; `job_sightings`; Fetch Gateway + `host_policies`; dispatcher; engines GH/Lever/Ashby/Workable; classifier + class scoring; closure for ATS feeds; `anchors.yaml` seed (~30 global + ~20 NCR); apply-URL discovery from existing crawls; Lever ETag + size-aware intervals | First ~300–500 boards polled; P1/P2 alerts within 10 min of publish; closed jobs disappear from feed |
| **B** (≈1.5 wk) | Discovery: HN, GitHub lists, YC, Himalayas companies, funding RSS, contractor marketplaces (Braintrust, Contra, Gun.io, Lemon.io); resolver; prober with budgets; tiering job; liveness ladder for aggregator-only jobs | Watchlist grows without manual input; dormant/retired transitions observed |
| **C** (≈1 wk) | Pay evidence (own postings, HN, LCA); pay band + demotion; Workday **scoped** engine for NCR anchors; SmartRecruiters/Recruitee/Teamtailor engines | Below-floor companies demoted; P3 digest populated |
| **D** (later) | Common Crawl bulk seed; `custom_json` for Microsoft/Google/Amazon/Amex/Oracle/SAP/Shopify; Keka/Darwinbox (if ever wanted); ops dashboard polish | Coverage breadth |

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Vendor blocks us | Gateway politeness + budgets + circuit breaker + no spoofing; operator alert on first block |
| False "new" storm on a feed format change | External-id stability tests per engine (fixtures); `suspect_drop` guard; cap alerts/hour per board (10) |
| False closures | Only successful polls count; N=2; suspect-drop guard; reappearance restores |
| Wrong classification (P1 vs restricted) | `class_reason` stored and shown; one-click "reclassify" feedback in UI feeds a pattern list |
| Wrong ATS slug from curated list | Resolver verifies every board by probing before it is polled |
| Big-board bandwidth (Lever) | ETag + size-scaled interval |
| Discovery floods probe queue | `probe_budget_per_day` per host |

## 14. Open items for approval

1. D9 — onsite NCR at MNCs counts as P3 (scored −5 vs hybrid)?
2. D10 — P2 alerts instant (not digest)?
3. Alert cap per board per hour = 10 (spillover goes to digest) — OK?
4. Anchor lists (`anchors.yaml`): the ~30 global + ~20 NCR companies listed in discussion — add/remove?
