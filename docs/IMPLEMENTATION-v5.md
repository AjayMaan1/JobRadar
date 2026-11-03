# JobRadar v5 — dynamic user preferences (implementation notes)

Implements `docs/HLD-dynamic-preferences.md` with the agreed decisions: fixed three tiers with editable
parameters (schema supports up to 8, first match wins), **USD pivot** (INR columns kept), **90-day active-user
fan-out cap**, **private + system presets**, **single-user auto-apply of crawl-scope suggestions**.
Migration: `20261001000000_v5_dynamic_preferences`. Behaviour-preserving for the current owner.

## Components

| Layer | What | Where |
|---|---|---|
| Global facts | `extractJobFacts()` → work mode, normalised locations (country/metro/region via a gazetteer), **structured geo constraints** (`allow`, `restrict` + source, `tzWindow`, `eorOk`, evidence), employment/seniority/category/skills, salary with USD pivot, company; `eligibleFor(facts, country, tz)` pure | `packages/extractor/src/geo/{dictionary,facts}.ts`; stored in `job_facts` by `ExtractorService` |
| Preference document | zod schema (closed `when` vocabulary), `parsePreferences` + `lintPreferences`; system presets (`legacy-india-remote` = today's behaviour, `us-remote`, `eu-remote`, `hybrid-metro`); `legacyDocFromEnv()` seeds the owner from `PAY_FLOOR_INR` / `INSTANT_ALERT_CLASSES` / `NCR_CITIES` | `packages/prefs/src/{schema,presets}.ts` |
| Evaluator | `evaluate(job, prefs)` → tier / eligibility / score (tier ≤40 + pay bands ≤30 + role fit ≤15 + transparency 5 + source 5) / reasons / exclusion; `EVALUATOR_VERSION` | `packages/prefs/src/evaluate.ts` |
| Storage | `user_preferences` (active doc, version), `preference_presets`, `preference_history` (append-only, revert), `job_user_evals` (user × job), `job_facts`, `jobs.salary_usd_*` | schema + migration |
| Services | `PreferencesService` (ensure/save/history/revert/presets/apply), `EvalService` (fan-out to active users, idempotent per-version re-evaluation, facts backfill for pre-v5 jobs, dry-run preview), `CrawlScopeService` (union of users: excluded HQs ∩, metros ∪, lowest floor; Workday scope suggestions + apply) | `packages/prefs/src/services/*` |
| Pipeline | enrich → facts → `evaluateJob` for active users → **per-user alerts** (recipient matched on *their* tier, their label/reasons in the message); `prefs-reeval` queue/worker (+ inline mode); tiering uses evals + crawl policy instead of `india_hq` / P1-P2-P3; digest served at each user's `alerts.digestHour` in their timezone (hourly scheduler) | `watchlist/enrich.service.ts`, `tiering.service.ts`, `notifications`, `apps/worker/src/workers/prefs.worker.ts` |
| API | `GET/PUT /api/preferences`, `POST …/preview`, `GET/POST …/presets`, `DELETE …/presets/:id`, `POST …/presets/:id/apply`, `GET …/history`, `POST …/revert`, `GET/POST /api/admin/crawl-scope`; `/api/jobs` inbox = `job_user_evals` (`class` = tier id / `eligible` = default tiers; response carries `engine`, `tiers`, `evalsPending`, per-job `eval`) | `apps/web/app/api/preferences/**`, `api/jobs/route.ts` |
| UI | `/preferences` page: home · work modes · tiers (order, points, instant, conditions) · role · pay · companies · live preview (tier counts + examples) · presets · history; first-run wizard; feed chips/labels/“why” from the user's tiers; Health → preferences engine tiles + crawl-scope suggestions (apply) | `apps/web/app/components/preferences/*`, `JobListToolbar`, `JobRow`, `JobDetailPanel`, `health/page.tsx` |

## Behaviour preservation (golden gates)

- `packages/extractor/src/geo/facts.test.ts`: every legacy classifier fixture maps to the same class through
  facts + the legacy preset.
- `packages/prefs/src/evaluate.test.ts`: `evaluate × legacy-india-remote` reproduces P1/P2/P3 and the legacy
  score bands (40/30/15 tier, INR pay bands, 8/4/3 role fit).
- Legacy columns (`jobs.opportunity_class`, `base_score`) are still written for one release; `PREFS_ENGINE=legacy`
  restores the old feed/alert/tiering paths for A/B (Health shows the engine).

## What the upgrade does for the existing owner

1. Migration adds tables/columns, backfills `salary_usd_*` from INR.
2. Worker start: system presets upserted; the first admin gets a preference document from the env
   (`legacy-india-remote` + `PAY_FLOOR_INR`/`INSTANT_ALERT_CLASSES`/`USER_TARGET_SKILLS`), role seeded from the resume profile.
3. First `GET /api/preferences` (or the first enrich) evaluates; the inbox shows legacy classes with an
   "being applied" banner until the first evaluation run completes (`evalsPending`).
4. Nothing else changes: same tiers, same alerts, same NCR hybrid rule, same pay floor.

## Verification (offline sandbox)

Migrations on Postgres 16 **PASS (30 tables)** · unit **172/172** (+27 new: facts, evaluator, services, digest hour) ·
sandbox e2e **16/16** · new `e2e-prefs` **5/5** (two users, different tiers for the same corpus, per-user alerts,
evals-driven inbox, preview, save → re-evaluation of one user only, union crawl policy) · offline typecheck OK
(the 73 pending errors are exactly the new Prisma models/fields until `pnpm db:generate`).

Needs online CI: `pnpm install` (new package `@jobradar/prefs`), `pnpm db:generate`, `pnpm -r typecheck`,
`next build`, `tools/e2e/run-local.sh` (new v5 step).

## Deferred / next

- Tier condition vocabulary is intentionally closed; new conditions (e.g. `minCompanySize`, `titleRegex`) are a
  schema + evaluator change with a golden test.
- `jobs.opportunity_class` / INR band code removal after one release on `PREFS_ENGINE=evals`.
- Saved searches as alert rules (on top of tiers).
