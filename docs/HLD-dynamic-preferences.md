# HLD — Dynamic user preferences (for review)

Status: **implemented (v5)** — see `IMPLEMENTATION-v5.md`. Decisions taken: fixed three tiers with editable parameters (schema supports N), USD pivot, 90-day active-user fan-out, private + system presets, single-user auto-apply of crawl scope. Goal: every user gets their own classification, ranking, feed defaults
and alerts from *their* preferences, stored and versioned, while the crawler/corpus stays shared and the
current owner's behaviour is preserved bit-for-bit after migration.

## 1. The problem in one sentence

Today one person's preferences are compiled into **shared rows** (`jobs.opportunity_class`, `jobs.base_score`,
`companies.tier`) and env constants (`NCR_CITIES`, `PAY_FLOOR_INR`, `INSTANT_ALERT_CLASSES`, INR units,
IST schedules). A second user with different needs cannot exist without overwriting the first.

## 2. Principle: facts are global, preferences are personal, evaluations are derived

```
                 ┌───────────────────────── GLOBAL (computed once per job, user-independent) ──────────────────────────┐
 crawl ─► extract ─►  JobFacts: work mode · locations[] (country/metro, normalised) · geo constraints {allow[], deny[],
                      tz window, EOR ok} · employment type · seniority · salary {amount, currency, period, usd_min/max}
                      · skills (from requirements) · company {hq, size, tags}            → jobs.* + job_facts (JSONB)
                 └──────────────────────────────────────────────┬──────────────────────────────────────────────────────┘
                                                                │ × (for every active user)
                 ┌───────────── PERSONAL (stored, versioned) ───┴───────────────┐   ┌──────── DERIVED (per user × job) ────────┐
                 │ user_preferences (active doc, schema v, source)              │   │ job_user_evals: tier · reasons[] · score  │
                 │ preference_presets (system + user named docs)                ├──►│ · prefs_version · evaluated_at            │
                 │ preference_history (append-only snapshots, revert)           │   │ = what the feed, alerts and digest read   │
                 └──────────────────────────────────────────────────────────────┘   └──────────────────────────────────────────┘
```

- **Facts** replace the India-specific regex outcome with *structured* geo/eligibility data (§4). They are
  extracted once, cheaply, and never change per user.
- **Preferences** are a validated JSON document per user (§5), editable in the UI, seeded from the resume
  + a system preset, saved as named presets, with history.
- **Evaluations** are a pure function `evaluate(facts, prefs) → { tier, reasons, score }` (§6) run in the
  worker for every (job, user). The feed, alerts and digest read `job_user_evals` instead of
  `jobs.opportunity_class` / `base_score`. Cost is tiny (regex/set checks on stored facts): 50 users × 3k new
  jobs/day = 150k evals/day; a preference change re-evaluates that user's open jobs (≤ 50k) in one batch job.

What stays global on purpose: the **crawl scope** (which boards/metros we poll, pay-floor demotion of
companies). It is a cost decision for the deployment, computed as the *union* of users' interests and
shown to the admin as suggestions, never driven directly by one user (§8).

## 3. Component diagram

```
┌──────────────┐     PUT /api/preferences            ┌─────────────────────────┐
│  Preferences │ ───────────────────────────────────►│ web: PreferencesService │──► user_preferences (+history)
│  page/wizard │ ◄─── GET /api/preferences/preview ──│  validate (zod) · diff  │──► enqueue prefs-reeval(userId)
│  (live tier  │      { tier counts over open jobs } │  preview = evaluate()   │
│   counts)    │                                     │  over a 2k-job sample   │
└──────────────┘                                     └─────────────────────────┘
                                                                │
        worker                                                  ▼
┌────────────────────────┐   new/updated job   ┌──────────────────────────┐   per active user   ┌──────────────────┐
│ enrich.worker          │ ───────────────────►│ FactsExtractor (global)  │────────────────────►│ Evaluator (pure) │
│ (unchanged pipeline)   │                     │ geo constraints · metros │                     │ facts × prefs →  │
└────────────────────────┘                     │ salary→USD · work mode   │                     │ tier/score/why   │
                                               └──────────────────────────┘                     └────────┬─────────┘
┌────────────────────────┐   prefs changed                                                               │ upsert
│ prefs-reeval.worker    │ ─── batch over open jobs (5k/step) ────────────────────────────────────────────┤
└────────────────────────┘                                                                               ▼
                                                                                              job_user_evals(user, job)
                                                                                                         │
   feed /api/jobs?tab=browse ◄── join evals (tier, score) ─────────────────────────────────────────────────┤
   alerts: instant if eval.tier ∈ channel.tiers & score ≥ channel.minScore ◄──────────────────────────────┤
   digest per channel at channel.digestHour in user.timezone ◄────────────────────────────────────────────┘
```

## 4. Global facts (what changes in extraction)

Today: `findIndiaOk()` / `findRestriction()` answer a yes/no question for one country. Tomorrow the same
phrase patterns are **parameterised by a region dictionary** and emit structure:

```ts
interface JobFacts {
  workMode: 'remote' | 'hybrid' | 'onsite' | 'unknown'
  locations: Array<{ raw: string; country?: string; metro?: string; region?: string }>   // normalised via a gazetteer (metro → country)
  geo: {
    allow: string[]          // ['WORLDWIDE'] | ['APAC','IN'] | ['US','CA'] … (ISO-2 or region tokens)
    deny: string[]           // ['US_ONLY'] means "US residents only" → deny everyone else
    tzWindow?: { minUtc: number; maxUtc: number }   // "UTC+3…+8", "IST overlap" → window
    eorOk: boolean           // hiring via Deel/Remote/EOR or contractor-anywhere
    evidence: string[]       // phrases, for the UI "why"
  }
  employmentType, seniority, category
  salary?: { min, max, currency, period, usdMin, usdMax, confidence }   // USD is the pivot; INR columns kept for compat
  company: { hqCountry?, sizeBucket?, tags[] }
}
```
`eligible(facts, homeCountry, tz)` is then a pure function: allow-list contains the country/region or
WORLDWIDE, nothing denies it, tz window (if any) contains the user's offset, or EOR ok. The existing LLM
extractor already emits an `eligibility` field; it is refined to emit `geo` in this shape.

Golden-test gate: for the current corpus, `evaluate(facts, OWNER_PRESET)` must reproduce today's
`opportunity_class` on ≥ 99% of rows before the switch (the 1% are reviewed by hand — they are usually
today's false positives).

## 5. The preference document (stored, versioned)

```jsonc
{
  "schemaVersion": 1,
  "home":   { "country": "IN", "metros": ["delhi-ncr"], "timezone": "Asia/Kolkata", "currency": "INR" },
  "work":   { "modes": ["remote", "hybrid"], "hybridMetros": ["delhi-ncr"], "onsiteMetros": [] },
  "role":   { "targetTitles": ["Backend Engineer"], "categories": ["Backend","Full Stack","DevOps","AI/ML","Data"],
              "seniority": ["senior","lead","staff","principal"], "skills": ["Go","Kafka", …],      // seeded from profile
              "employmentTypes": ["full_time","contract"] },
  "pay":    { "floor": 3000000, "currency": "INR", "bands": [{ "min": 9000000, "pts": 30 }, …], "requireTransparency": false },
  "companies": { "excludeHqCountries": ["IN"], "exclude": ["Acme Staffing"], "onlyTags": [], "minSize": null },
  "tiers": [                                                                     // ordered; first match wins
    { "id": "tier1", "label": "Global remote",        "enabled": true, "instant": true,  "points": 40,
      "when": { "workMode": ["remote"], "eligibleForMe": true } },
    { "id": "tier2", "label": "Remote in my country", "enabled": true, "instant": true,  "points": 30,
      "when": { "workMode": ["remote"], "locationCountry": "home" } },
    { "id": "tier3", "label": "Hybrid near me",       "enabled": true, "instant": false, "points": 15,
      "when": { "workMode": ["hybrid"], "locationMetro": "home.metros", "companyTag": ["mnc","big_tech"] } }
  ],
  "feed":   { "defaultTiers": ["tier1","tier2","tier3"], "hideEmploymentTypes": ["internship","part_time"], "sort": "newest" },
  "alerts": { "digestHour": 8, "quietHours": [22, 7] }
}
```
- Validated by a zod schema; `when` is a **closed** condition vocabulary (no free-form rules), so evaluation
  is deterministic, explainable and safe.
- `"home"` placeholders (`"home"`, `"home.metros"`) let presets be portable between users.
- System presets ship the current behaviour verbatim: **`legacy-india-remote`** = today's P1/P2/P3 + INR bands
  + NCR; plus `us-remote`, `eu-remote`, `hybrid-metro` starters. The owner's row is migrated from today's env
  values, so nothing changes for you on upgrade.

### Storage
```
user_preferences      (user_id PK, doc JSONB, schema_version, source manual|wizard|preset|seed, version int, updated_at)
preference_presets    (id, owner_user_id NULL=system, name, description, doc JSONB, schema_version, created_at)
preference_history    (id, user_id, version, doc JSONB, changed_at, changed_by, note)   -- append-only, revert target
job_user_evals        (user_id, job_id PK; tier, reasons JSONB, score int, components JSONB, prefs_version, evaluated_at)
                      indexes: (user_id, tier, evaluated_at DESC), (user_id, score DESC), (job_id)
job_facts             (job_id PK, facts JSONB, extractor_version, updated_at)   -- or columns on jobs; JSONB keeps migrations small
```
`candidate_profiles` keeps resume-derived data (skills, headline, years); preferences *reference* it for
seeding and role-fit, they do not duplicate it. Erasure/export hooks already cascade from `users`.

## 6. Evaluation (pure, versioned like ats-v1)

```
evaluate(facts, prefs) → {
  tier: first enabled tier whose `when` matches (else 'none'),
  eligible: boolean + evidence,
  score: tierPoints + roleFit(prefs.role vs facts.skills/title/category/seniority) + pay(prefs.pay vs facts.salary→user currency)
         + salaryTransparency + sourceQuality      (freshness stays read-time, as today),
  reasons: ["remote", "worldwide", "pays ≥ floor", "skills: Go, Kafka"]
}
```
- `EVALUATOR_VERSION` + `prefs_version` stored on every eval; golden tests pin outputs.
- Role fit reuses today's scorer with prefs instead of `RANKING_CONFIG`; pay bands are converted
  prefs-currency → USD once per evaluation (FX table already exists in the extractor).
- `jobs.base_score` becomes user-independent (source quality + salary transparency only); the UI shows
  `eval.score`. `jobs.opportunity_class` is kept for one release as the *owner's* tier (read-only shim), then dropped.

## 7. Flows

**New job** (enrich.worker, unchanged up to step 8): extract facts → `for user in activeUsers: upsert eval`
→ alerts fan out per user using `eval.tier/score` against that user's alert channels (the per-user channels
from v4). Active users = users with a preference doc and a login in the last 90 days (cap fan-out).

**Preference change**: `PUT /api/preferences` validates, bumps `version`, appends history, enqueues
`prefs-reeval {userId, version}` → worker re-evaluates that user's open jobs in 5k batches (idempotent by
version; a newer version cancels the older run) → UI shows "re-evaluating 12,400 jobs…" via the task stream.

**Preview before save**: `POST /api/preferences/preview {doc}` evaluates a fixed 2k-job sample in-process
(~50 ms) and returns tier counts + 5 example jobs per tier, so the user sees the effect of "also accept
hybrid in Bengaluru" before committing.

**Onboarding wizard** (first login / no doc): country + metro + timezone detection → work modes → pick a
preset → role seeded from profile/resume → pay floor in local currency → preview → save.

## 8. What remains deployment-level (admin)

| Concern | Why global | Proposal |
|---|---|---|
| Boards polled, Workday query scopes, metro anchors | crawl cost & politeness budgets | `crawl_scope` admin doc = union of users' `home.metros`/countries, shown as suggestions ("2 users want Bengaluru hybrid — add anchors?"); admin approves |
| Company tiering pay-floor demotion | shared `companies.tier` | demote only when below the **lowest** user floor (in USD); otherwise hot/warm/cold by activity |
| HQ-country company gate (`hq === 'IN' → none`) | today a user preference pretending to be a crawl rule | moves into prefs (`companies.excludeHqCountries`); tiering no longer gates on it |
| Schedules (liveness, retention, discovery) | infra | keep deployment tz; digest hour becomes per channel |

## 9. Migration (behaviour-preserving)

1. `job_facts` extractor + `geo` structure; backfill open jobs; golden test vs today's classes (≥ 99 %).
2. Tables + zod schema + system presets; **migration seeds the owner's doc from env** (`PAY_FLOOR_INR`,
   `NCR_CITIES`, `INSTANT_ALERT_CLASSES`, `RANKING_CONFIG`) = preset `legacy-india-remote`.
3. Evaluator + `job_user_evals` backfill for the owner; feed/alerts/digest switch to evals behind
   `PREFS_ENGINE=evals` (old path kept one release for A/B: compare counts in `/health`).
4. Preferences API + page + wizard + presets/history.
5. Remove env constants and `opportunity_class`/INR-band code paths; tiering uses USD floors.

Effort: ~3 weeks (1: facts+goldens · 2: evals+switch · 3: UI/presets/wizard). Each phase ships alone.

## 10. Decisions needed

1. **Tier vocabulary**: fixed three tiers with editable parameters (simple UI) vs. user-defined ordered tiers
   with the closed condition set (more power, more UI). Proposal: ship fixed-three first, schema already supports N.
2. **Pivot currency USD** with INR kept for compatibility — OK? (Alternative: keep INR pivot; fine for India-only
   deployments, wrong for anyone else.)
3. **Active-user fan-out cap** (evaluate for users active in last 90 days; others re-evaluated on next login) — OK?
4. **Presets**: are user-shared (public) presets wanted in a multi-user install, or only private + system?
5. Should the global crawl-scope suggestions auto-apply for small deployments (single user) — i.e., if you
   change home metro, we add the anchors/Workday scope without admin approval?
