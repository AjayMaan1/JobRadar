# JobRadar v4 — hardening implementation notes

Implements every P0/P1/P2 finding and the good-to-have list from `audit/AUDIT-v4-gap-analysis.md`, plus the
items found while re-checking (NEW-26, NEW-27). Migration: `20260901000000_v4_hardening`.
Runbook: `docs/RUNBOOK.md`. API: `docs/openapi.json`.

## What changed, by finding

| Finding | Change | Where | Test |
|---|---|---|---|
| **NEW-01** PII erasure incomplete | `ErasureService` (vectors → files → rows) used by `DELETE /api/me`, resume delete, retention; migration deletes already-orphaned vectors | `packages/resume/src/services/erasure.service.ts`, `api/me`, `retention.service.ts` | `erasure.service.test.ts` (5), e2e cleanup asserts zero vectors |
| **NEW-02** no backups | `backup.sh` (pg_dump custom + objects tarball, optional AES encryption, retention, rclone, dead-man ping), `restore.sh`, `verify.sh` restore drill; cron + systemd timers + compose `backup` service; CI restore drill | `tools/backup/*`, `deploy/systemd/*`, `.github/workflows/ci.yml` | exercised end-to-end in the sandbox (encrypt → restore → 25 tables + objects) |
| **NEW-03** multi-user leaks | `jobs.description_manual/_by/_at` (paste never overwrites crawl, only accepted when crawl unusable, labelled in UI); global ranking ignores profiles when >1 user; per-user `alert_channels` with env fallback; worker startup warning | `analysis.service.ts`, `jobs/[id]/jd`, `job-serializer.ts`, `ranking.service.ts`, `notification.service.ts`, `api/alert-channels` | integration test, `ranking.test.ts` (+2), `notification.service.test.ts` (+2), e2e 409 step |
| **NEW-04** cost/abuse controls | `limitUser()` per-user limits on upload/analysis/suggest/variants/answers/cover/render/jd/export; in-memory `MemoryBudgetStore` so inline mode is budgeted; `TRUSTED_PROXY` gate on `x-forwarded-for` | `lib/rate-limit.ts`, routes, `packages/llm/src/budget.ts`, `lib/auth.ts` | `llm.test.ts` (+1) |
| **NEW-05** worker death silent | heartbeat (`worker:heartbeat`, 30 s) from a plain interval; `/api/health` shows Worker tile, alerts red and sends a deduped ops Telegram from the **web** tier; `:9464/healthz`; Docker HEALTHCHECKs; systemd `Restart=always` | `apps/worker/src/ops.ts`, `api/health`, `OpsAlerter` | boot test loads `ops.ts` |
| **NEW-06** observability | `@jobradar/log`: structured logger with key-based redaction, child bindings, level; Prometheus registry + shared metric names; `/api/metrics`, worker `/metrics`; BullMQ outcome/duration/depth, LLM calls/cost/tokens/latency, rate-limit rejections, log-level counters; all 148 `console.*` call sites migrated | `packages/log/*`, `api/metrics`, `ops.ts`, `budget.ts` | `log.test.ts` (7) |
| **NEW-07** account lifecycle | password change (revokes others), reset request/complete (single-use hashed tokens, 30 min), e-mail verification for sign-up, per-account lockout, absolute session cap, sessions list/revoke/“sign out everywhere”, bearer tokens for the extension; Login page flows; Account section in Profile | `api/auth/*`, `lib/auth.ts`, `LoginForm.tsx`, `AccountSettings.tsx`, `auth_tokens` table | e2e sessions step |
| **NEW-08** vector index staleness | `Embedding.updatedAt`; `JobVectorIndex` Map-keyed, pages on `updatedAt`, periodic reconcile evicts closed/deleted jobs, `evictOwner()`; closed-job vector retention (30 d) + orphan sweep | `embedding.service.ts`, `erasure.service.ts`, retention | `vector-index.test.ts` (2) |
| **NEW-09** perf cliffs | Postgres FTS (`search_tsv` generated column, weighted) + `pg_trgm` on title/company; `/api/jobs?q=` = FTS ∪ trigram ∪ semantic via RRF, ILIKE only as pre-migration fallback (auto re-probe); `vectorsMany()` removes the N+1 in fit computation; closed jobs excluded from fits | `lib/search.ts`, `api/jobs`, migration, `semantic.service.ts` | FTS query verified on Postgres 16 |
| **NEW-10** HEALTH_TOKEN broken | handler honours the token, timing-safe compare | `api/health` | sandbox e2e health step |
| **NEW-11** dead experience filter | `experience_min` backfilled from `yearsMin` at analysis; filter treats unknown as match | `analysis.service.ts`, `api/jobs` | — |
| **NEW-12** headers/CSRF | security headers (CSP report-only by default, `CSP_ENFORCE=1`), Origin/Sec-Fetch-Site check on cookie-authenticated mutations, `ALLOWED_ORIGINS` | `next.config.ts`, `middleware.ts` | — |
| **NEW-13** inline queue | `INLINE_MAX_PENDING` cap → 503 `queue_full` + retry-after; unknown task ids report `task_lost` so the UI stops polling | `inline-runner.ts`, `services.ts`, `api/tasks/[id]` | — |
| **NEW-14** master race | serializable transaction (+P2034 retry) decides "first upload becomes master" | `resume.service.ts` | — |
| **NEW-15** AUTH_DISABLED footgun | ignored in production unless `AUTH_DISABLED_I_KNOW_WHAT_I_AM_DOING=1` | `lib/auth.ts`, `middleware.ts` | — |
| **NEW-16** body caps | `content-length` caps at the edge (256 KB JSON / 6 MB upload), 60 k-char JD cap | `middleware.ts`, `jd` route | — |
| **NEW-17** hygiene/packaging | `.gitignore` (data/, backups/, generated client, report artifacts), npm lockfile removed, `Dockerfile.web` (standalone) + `Dockerfile.worker` (Playwright base), compose `app` profile (web runs migrations, worker, backup), systemd units | root | CI `images` job |
| **NEW-18** dead `followUpAt` | follow-up reminders: set with "mark applied" (`followUpInDays`/`followUpAt`), daily 09:00 IST job announces due ones on the user's channels and appends a timeline event; UI selector + date field | `applykit.service.ts`, `notification.service.ts`, scheduler, `ApplyKitPanel.tsx` | `notification.service.test.ts` (+1), e2e step |
| **NEW-19** offline harness rot | typed mini-`zod` shim, `zod-to-json-schema`, `unpdf`/`mammoth` (pdfjs-backed), AWS SDK stubs, `next/headers`, functional `ioredis`; fake Prisma gained v3c/v4 models, `distinct`, compound uniques, Buffer-safe updates; vitest shim gained `rejects`, `arrayContaining`, class `toThrow`; **offline typecheck** (`tools/typecheck-offline`) against the real generated Prisma types | `tools/testkit/*`, `tools/typecheck-offline/*` | sandbox e2e 16/16, 147 unit tests offline |
| **NEW-20** polling only | `GET /api/tasks/:id/stream` (SSE) + client fallback to polling | `api/tasks/[id]/stream`, `api-client.ts` | e2e SSE step |
| **NEW-21** dead queue | `applyKitQueue` removed | `queues.ts` | — |
| **NEW-22** orphan files | `ObjectStore.list()`, `sweepOrphanFiles()` (grace window) in retention | storage, erasure | `storage.test.ts` (+1), `erasure.service.test.ts` (+1) |
| **NEW-23** no export | `GET /api/me/export` (JSON + signed file links) | `api/me/export` | e2e step |
| **NEW-26** (recheck) dangling timeout timers → unhandled rejection | `withTimeout()` everywhere `Promise.race` + `setTimeout` was used | `packages/log/src/timeout.ts`, services/health/rate-limit | `log.test.ts` |
| **NEW-27** (recheck) crawler egress SSRF + unbounded bodies | `assertPublicUrl()` (scheme, internal names, private/link-local/metadata ranges, DNS resolution incl. mixed records) on every gateway fetch and redirect hop; manual redirect following; `readBodyCapped()` (8 MB default) | `packages/crawler/src/gateway/egress.ts`, `fetch-gateway.ts` | `egress.test.ts` (5) |
| **GH-1** SSE | see NEW-20 | | |
| **GH-2** FTS | see NEW-09 | | |
| **GH-3** DLQ | `GET/POST /api/admin/queues` + Health → Queues panel (retry / remove / clean) | `api/admin/queues`, `QueuesPanel.tsx` | — |
| **GH-4** OpenAPI | `docs/openapi.json` (52 paths) + drift test that fails on undocumented or phantom routes | `apps/web/lib/openapi.test.ts` | 3 tests |
| **GH-5** follow-ups | see NEW-18 | | |
| **GH-6** per-user alerts | see NEW-03; Profile → Account & alerts UI | | |
| **GH-7** export | see NEW-23 | | |
| **GH-8** cover letter | `draftCoverLetter()` (LLM, grounded via `validateGrounding`; deterministic template without LLM), `cover_letter` suggestion kind, `POST /api/analyses/:id/cover`, Apply Kit UI with tone | `packages/resume/src/apply/cover.ts`, `applykit.service.ts` | e2e step |
| **GH-11** LLM cache | `BudgetedProvider` caches identical prompts by hash (7 d, `LLM_CACHE=off`) | `budget.ts` | `llm.test.ts` |

Not done on purpose (next phase, as agreed): **GH-9/C12 browser extension** (bearer-token auth is in place for it), **GH-10 pgvector**
(trigger: >50k jobs), **GH-12 mobile/PWA**, saved searches (alert channels cover the multi-user need first).

## Verification

Offline (this sandbox, no network): `tools/sandbox-e2e/run-all.sh` → migrations on Postgres 16 **PASS (25 tables)**,
unit **80/80**, sandbox e2e **16/16**; all package unit tests **147/147**; `tools/typecheck-offline/run.sh` **OK**
(28 errors that are exactly the new Prisma fields awaiting `pnpm db:generate`, listed by the script); backup →
encrypted → restore drill exercised against the real database.

Needs the online CI (not runnable here): `pnpm install` (new workspace package `@jobradar/log`), `pnpm db:generate`,
`pnpm -r typecheck`, `next build`, `tools/e2e/run-local.sh` (now with `EMBEDDING_PROVIDER=fake` so vector erasure is
asserted, plus six v4 steps), Docker image builds, `prisma migrate diff` drift check (new CI step).

## Operational defaults that changed

- Production logs are JSON; `LOG_FORMAT=pretty` for a terminal.
- `x-forwarded-for` is ignored unless `TRUSTED_PROXY=1`.
- `AUTH_DISABLED=1` does nothing in production.
- Inline mode (`QUEUE_MODE=inline`) now has an LLM budget and a queue cap.
- Closed jobs lose their vectors after 30 days (`CLOSED_JOB_VECTOR_RETENTION_DAYS`).
- `jobs.description` is crawler-owned; pastes go to `description_manual` (existing manual rows were migrated).
