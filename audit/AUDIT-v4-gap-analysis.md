# JobRadar — Principal-Engineer Audit v4 (gap analysis beyond the v3 backlog)

Scope: `JobRadar-main` (post C0–C11 + C13 implementation, ~75k LOC TS across 300 files).
Method: full read of schema, all 39 API routes, middleware/auth, worker/queues/scheduler, the
`@jobradar/{resume,llm,storage,crawler,watchlist,ranking,notifications}` packages, CI, docs; ran the
bundled offline harness; cross-checked every claim against `audit/*.md` and `docs/*.md` so that **only new
findings** are listed. Every finding cites file:line evidence.

## Status (after the v4 implementation)

All P0/P1/P2 findings and the good-to-have list below are **implemented** — see `JobRadar-main/docs/IMPLEMENTATION-v4.md`
for the per-finding change/test table and `docs/RUNBOOK.md` for operations. Two further findings surfaced during the
re-check and were fixed in the same pass:

| # | Re-check finding | Severity | Fix |
|---|---|---|---|
| NEW-26 | `Promise.race([p, setTimeout-reject])` in `health/route.ts`, `rate-limit.ts`, `services.ts` leaves a timer that rejects after the race is won → **unhandled rejection** (crashes Node with default `--unhandled-rejections=throw`; reproduced in the sandbox harness) | P1 | `withTimeout()` helper (clears the timer), used everywhere |
| NEW-27 | Crawl gateway has **no egress SSRF guard and no response-size cap**: apply/careers URLs from feeds, HN, GitHub lists or the admin UI could point the worker at Ollama (:11434), Redis, the worker metrics port or cloud metadata (169.254.169.254); open redirects on public sites reach the same; `await res.text()` on unbounded bodies | P1 | `assertPublicUrl()` (scheme, internal names, private/link-local/CGNAT/ULA/metadata ranges, DNS resolution incl. mixed records) on every fetch and every redirect hop (redirects now followed manually), `readBodyCapped()` 8 MB |

Deferred by agreement (next phase): C12 browser extension (bearer-token auth now exists for it), pgvector (>50k jobs), mobile/PWA, saved searches.

## 0. Status check of the previously listed items (trust-but-verify)

| Listed item | Claimed | Verified | Note |
|---|---|---|---|
| F1 scheduler corruption | fixed | ✅ | `apps/worker/src/scheduler.ts` parses; boot smoke test exists |
| F2 auth | done | ✅ (with new gaps, §2) | in-house scrypt + server-side sessions |
| F3 stripHtml entity order + structure | done | ✅ | `engines/types.ts:68` |
| F4/F5/F7/F8/F10/F11/F13 | done | ✅ | requirements→skills, hydrator, profile prefs, `JobUserState`, `applyUrlNormalized`, `@@unique([userId,jobId])`, GH questions |
| **F9 experience filter** | *(never scheduled)* | ❌ **still broken** | `normalizer.ts:173` always null; `/api/jobs?experienceMax=` still `lte` → excludes every row (NEW-11) |
| C1-5 "rate limit mutating routes" | done | ⚠️ **partial** | only `login`/`register` are limited (NEW-04) |
| C11-1 `DELETE /api/me` full erasure | done | ❌ **incomplete** | embeddings survive (NEW-01) |
| `HEALTH_TOKEN` monitor access | done | ❌ **broken** | middleware passes, handler 401s (NEW-10) |
| Offline sandbox harness | green | ❌ **rotted** | no `zod`/v3-package shims → E2E import fails (NEW-19) |

---

## 1. New findings — by severity

Severity: **P0** fix before anything else · **P1** fix this sprint · **P2** next release · **P3** backlog.
Effort: S ≤ 1d · M 2–3d · L 4–6d.

### P0 — data loss / privacy

**NEW-01 · PII erasure is incomplete: resume/profile text survives account deletion in `embeddings`.**
`Embedding` is polymorphic (`ownerType`/`ownerId` strings, **no FK**, `schema.prisma` "v3c"), and each row
stores the raw chunk **text** (≤2000 chars of resume bullets / profile headline) next to the vector.
`DELETE /api/me` (`apps/web/app/api/me/route.ts`) deletes the user (+ Prisma cascades) and the file prefix —
the cascade cannot reach `embeddings`. Same for `ResumeService.delete()` (`resume.service.ts:153`) and for
tailored versions removed by `RetentionService`. The e2e step 24 "cascade verified" ran with
`EMBEDDING_PROVIDER=none`, so no embeddings existed to catch it.
*Violates the project's own invariant C11-1 ("zero rows/files remain") and the C13 guardrail ("vectors …
deleted by `DELETE /api/me`").*
→ Fix (S): delete `embeddings where ownerType in ('resume_version','profile') and ownerId in (…)` inside
`DELETE /api/me`, `ResumeService.delete`, and retention's tailored-version sweep; add an erasure test that
runs with `EMBEDDING_PROVIDER=fake`. Longer term: an `onOwnerDeleted(ownerType, ids)` lifecycle hook (§4.2).

**NEW-02 · No backup / restore story at all.**
No `pg_dump` job, no object-store sync, no restore runbook, no migration-rollback notes anywhere in
`docs/` or `tools/`. The system now holds users, password hashes, resumes (files + parsed JSON + rawText),
and the user's entire application history. A single disk failure on the "single box" deployment loses
everything. → Fix (S–M): nightly `pg_dump` + `STORAGE_LOCAL_ROOT` tarball with retention, restore drill
documented and tested in CI against a scratch DB (§4.3).

### P1 — security, cost, correctness

**NEW-03 · Multi-user tenancy is half-wired; enabling `ALLOW_SIGNUP=true` is unsafe today.**
Three shared-state leaks, all with self sign-up already implemented (`api/auth/register`):
1. *JD tampering:* any authenticated user can overwrite the **global** `jobs.description` via
   `POST /api/jobs/:id/jd` and pin it (`descriptionSource='manual'` sticks forever —
   `analysis.service.ts:63`). That poisons every other user's score/suggestions and is an indirect
   prompt-injection channel into other users' LLM runs. The crawled description is also irrecoverably lost
   (no provenance/previous-value column).
2. *Ranking leak:* global feed ranking uses "the most recently updated profile"
   (`ranking.service.ts:35 findFirst(orderBy updatedAt)`) — one user's skills reorder everyone's inbox.
3. *Alerting is global:* one Telegram chat / one email for all users (`notification.service.ts:133`).
→ Fix (M): short-term, guard `ALLOW_SIGNUP` with a startup warning + keep it off; store manual JDs
per-user (`JobUserDescription` or on `AtsReport`) falling back to the shared one; per-user alert channel
config before any real multi-user launch (§4.5).

**NEW-04 · Cost/abuse controls missing on every expensive endpoint.**
Only `login`/`register` are rate-limited. Unlimited per-user: resume upload (5 MB multipart, Chromium/LLM
work downstream), `POST /api/jobs/:id/analysis`, suggestions/variants/answers (LLM), renders (Chromium),
JD paste, `DELETE`+re-upload loops. The LLM daily budget partially compensates **but not in inline mode**:
`InlineRunner` builds the provider without Redis (`inline-runner.ts:30 createLlmProvider()` — no
`BudgetedProvider`), so the documented single-box mode has **no LLM budget at all**. Embeddings are never
budgeted. Also `clientIp()` trusts `x-forwarded-for` blindly (`lib/auth.ts:clientIp`) → the login rate
limit is trivially bypassed by rotating the header when the app is exposed without a trusted proxy.
→ Fix (S–M): apply `rateLimit()` to upload/analysis/suggest/render/jd routes (per-user key, not IP);
pass a budget into inline mode (in-memory `LlmBudget` fallback); only honour XFF behind
`TRUSTED_PROXY=1`.

**NEW-05 · No alert when the worker dies — the watchdog lives inside the thing it watches.**
Ops alerts (`health` sweep → Telegram) run **in the worker's own maintenance queue**. If the worker
process crashes or Redis is down, discovery, alerts, parsing and rendering silently stop; the web UI keeps
serving stale data; nothing pages you. There is no heartbeat, no liveness endpoint for the worker, no
systemd/Docker unit with restart policy (deploy doc is "run `pnpm worker:dev` on Linux Mint").
→ Fix (S): worker writes `worker:heartbeat` to Redis every 30 s; `/api/health` turns a stale heartbeat
into a red alert (web-side, admin-visible) + optional dead-man's switch (healthchecks.io ping). Package
both apps as systemd units / Docker images with restart policies (§4.3).

**NEW-06 · Observability is `console.log` only.**
148 `console.*` call sites; no log levels, no structured fields, no request/task correlation id, no
metrics endpoint, no error tracker. Debugging a failed render → grep stdout. PII discipline ("never log
resume text") is enforced only by convention, and `console.error('POST /api/resumes error:', err)` prints
whole error objects that can embed user data.
→ Fix (M): thin `@jobradar/log` wrapper (pino), redaction list, taskId/requestId propagation, `/metrics`
(prom-client) with queue depth, fetch outcomes, LLM latency/cost, render failures (§4.1).

**NEW-07 · Account lifecycle is missing around an otherwise solid core.**
No password change, no password reset (locked out = operator runs SQL), no email verification for signup,
no per-account lockout (IP-window only → distributed guessing of one account is unthrottled), no "active
sessions / sign out everywhere" (the `sessions` table already stores UA/IP — just no endpoint/UI), no
admin user management. Also: no absolute session lifetime (30-day *sliding* → a stolen cookie renews
forever).
→ Fix (M): `PATCH /api/auth/password` (re-auth + revoke other sessions), token-based reset via existing
SMTP, per-account counter alongside the IP counter, absolute cap (e.g. 90 d), sessions list + revoke (§4.4).

**NEW-08 · Semantic index staleness + unbounded vector growth.**
(a) `JobVectorIndex.refresh()` pages by `createdAt` (`embedding.service.ts:78-95`), but re-embedded chunks
are **upserts** that keep `createdAt` → a manually-pasted/hydrated JD never updates in-process search until
restart. (b) Deleted/closed jobs are never evicted from the in-memory index (memory + ghost hits), and the
`embeddings` table has no retention: vectors+text for closed jobs accumulate forever (retention sweeps
fetch_runs/sightings/reports but not embeddings). (c) `findIndex` per row makes refresh O(N·M).
→ Fix (S–M): add `updatedAt` to `Embedding` and page on it; evict ids on job close/delete (or rebuild
nightly); retention: delete job embeddings for jobs closed > N days; Map-keyed index.

**NEW-09 · Web/API perf cliffs already visible.**
- Search: `expandQuery` emits up to **14 terms × 4 columns** of unanchored `ILIKE '%…%'` including
  `description` (`api/jobs/route.ts:118`); no `pg_trgm`/tsvector index exists → sequential scans over the
  whole jobs table on every keystroke-search. Fine at 5k jobs; a cliff at 50k+.
- Feed: 5 relation includes per row + per-row `quickMatchDetail` regex scoring on every request; `sort=match`
  fallback loads 600 rows then sorts in JS.
- `computeFitsForUser` issues ~2–3 queries **per job × 2000 jobs** per profile save (N+1 in the worker).
→ Fix (M): pg_trgm GIN on (title, company) + tsvector on description behind the same API (§4.6); cache
quick-match per (user, job) in `job_user_states.matchScore` (the column already exists); batch vector fetch.

### P2 — should fix next release

**NEW-10 · `HEALTH_TOKEN` monitoring is broken end-to-end.** `middleware.ts:15` lets the request through,
but the handler (`api/health/route.ts:8`) still calls `requireAdmin()` → monitors get 401. Also the token
compare in middleware is not timing-safe. → honour the token in the handler (read-only summary), compare
with `timingSafeEqual` (S).

**NEW-11 · Dead filter (old F9).** `experienceMin/Max` are never populated (`normalizer.ts:173`), yet
`experienceMax` filtering is `lte` → any API client using it gets zero rows. `JobRequirements.yearsMin`
now exists — backfill `jobs.experienceMin` from it on analysis, or treat `null` as match (S).

**NEW-12 · No security headers / CSRF defence-in-depth.** No CSP, HSTS, `X-Frame-Options`,
`X-Content-Type-Options`, `Referrer-Policy` (`next.config.ts` has no `headers()`); no Origin check on
mutating routes (SameSite=Lax is currently the only CSRF control). One `headers()` block + an origin
assertion helper (S).

**NEW-13 · Unbounded/duplicated inline queue.** `InlineRunner.chain` is an unbounded serial promise chain
in the web process: a burst of analyses queues behind one slow LLM call with no cap, no shed, no
persistence — tasks are silently lost on restart while the UI keeps polling a task id that no longer
exists (memory TaskTracker). Cap the queue, persist task state, surface "lost" to the UI (S–M).

**NEW-14 · Upload/parse race can create two master resumes.** `createFromUpload` decides
`isMaster: masterCount === 0` by count (`resume.service.ts:36`) — two parallel first uploads → two
masters; profile seeding then depends on ordering. Unique partial index `(userId) where is_master` +
transaction (S).

**NEW-15 · `AUTH_DISABLED=1` footgun.** A single env var disables all auth including admin routes, with no
`NODE_ENV` guard (`middleware.ts:12`, `auth.ts:authDisabled`). Refuse it when `NODE_ENV=production` (S).

**NEW-16 · Request-body limits rely on defaults.** JSON routes `await req.json()` with no explicit size
cap before `.slice(…)` (e.g. 60k JD paste parses the full body first); multipart buffers fully in memory
before the 5 MB check. Put a byte cap at the edge (middleware `content-length` check) (S).

**NEW-17 · Repo/deploy hygiene.**
- `data/` (the default `STORAGE_LOCAL_ROOT`) is **not** in `.gitignore` → one `git add -A` commits user
  resumes. `apps/web/data/verify-objects` is already tracked.
- Generated Prisma client (`packages/db/generated/`, MBs) and a stale npm `package-lock.json` (pnpm repo)
  are committed; `reports/` artifacts churn in every commit.
- No Dockerfiles/compose services for web+worker; `docker-compose.yml` is infra-only.

**NEW-18 · `Application.followUpAt` is dead schema** — follow-up reminders were part of the tracker vision
but nothing reads/writes it (no grep hits outside schema). Either implement reminders (good-to-have GH-5)
or drop the column.

**NEW-19 · Offline verification harness rotted.** `tools/sandbox-e2e` shims predate v3: no `zod`,
`@jobradar/{llm,resume,storage}` shims → the advertised no-network E2E fails at import
(`Cannot find module 'zod'`). CI covers the online path, but the "auditable offline" property the project
sells is gone (S to restore).

### P3 — backlog

- **NEW-20** Task progress is HTTP polling; no SSE/WebSocket (each open tailor panel polls `/api/tasks/:id`).
- **NEW-21** `applyKitQueue` declared but never consumed/enqueued (`apps/worker/src/queues.ts:29`) — dead code.
- **NEW-22** Orphan-file windows: non-transactional file-store + DB writes (upload, delete) can strand
  objects or rows on crash; add a weekly orphan sweep.
- **NEW-23** No data export (`DELETE /api/me` exists; GDPR-style portability `GET /api/me/export` doesn't).
- **NEW-24** Accessibility/i18n never assessed (keyboard traps in modal flows, aria on score rings); no UI
  (Playwright) test layer — current E2E is API-level only.
- **NEW-25** Single Redis is a SPOF for sessions?—no; sessions are in PG (good) — but rate limits fall back
  to per-process memory and budgets fail-open design should be documented as a conscious choice.

---

## 2. Good-to-have features (with feasibility)

| # | Feature | Why | Feasibility / effort |
|---|---|---|---|
| GH-1 | **SSE task stream** (`GET /api/tasks/:id/stream`) | kills polling, instant progress | Easy: TaskTracker already writes states to Redis; add a Redis pub/sub channel + route handler streaming. S |
| GH-2 | **Hybrid FTS**: pg_trgm + tsvector under the existing `q=` | removes the ILIKE cliff, better ranking | Easy; one migration + query swap, keep `expandQuery` for recall. M (§4.6) |
| GH-3 | **BullMQ dashboard + DLQ** (bull-board behind admin) | retry/inspect failed user tasks | Drop-in package. S |
| GH-4 | **OpenAPI spec + generated client** | `api-client.ts` is 550 hand-written lines drifting from routes | zod-to-openapi on existing zod schemas. M |
| GH-5 | **Follow-up reminders** (uses dead `followUpAt`) + application timeline nudges ("applied 14d ago, no update") | closes the tracker loop | Maintenance cron + digest integration already exist. S–M |
| GH-6 | **Per-user saved searches & alert rules** (precondition for multi-user alerting) | today alerts are global classes only | Schema + evaluate in enrich path. M |
| GH-7 | **Data export** (`GET /api/me/export` → zip of JSON + files) | trust/portability, pairs with DELETE | Straightforward over existing stores. S |
| GH-8 | **Cover-letter generation** in the Apply Kit (grounded, same validator) | `coverNote` field exists but is manual | Reuses suggest pipeline. M |
| GH-9 | **Browser-extension autofill (C12)** | the biggest remaining UX win | Feasible; design in §4.7. L (2–3 wks) |
| GH-10 | **pgvector swap** when jobs > ~50k | removes in-memory index + staleness class of bugs | Already anticipated in schema comments; migration is mechanical. M |
| GH-11 | **Embedding/LLM response cache by prompt hash** | JD re-analysis after model restarts is frequent | S |
| GH-12 | **Mobile-responsive pass + PWA shell** | job hunting is a phone activity | M |

---

## 3. Feasibility review of the still-open *listed* items

| Listed item | Feasible? | Notes |
|---|---|---|
| C12 extension (P3) | **Yes** | No ToS issues (user clicks Submit). Needs a token/cookie-bridge auth path and CORS for the extension origin — see §4.7. |
| C0-4 real ATS fixtures | **Yes, with network** | Record once via a `RECORD=1` script through the gateway; commit sanitised cassettes; run nightly-only live checks so CI stays hermetic. |
| Hosted LLM (Anthropic) switch | **Yes** | `AnthropicProvider` exists; enable budget USD caps + PII mask already in place; decision is policy, not engineering. |
| Multi-user GA | **Only after NEW-03/NEW-07** | tenancy leaks + account lifecycle are the real blockers, not schema (userId scoping is done). |
| pgvector at scale | **Yes** | schema already isolates vectors; swap `JobVectorIndex` behind the same `search()` interface. |

---

## 4. High-level design for the remediation (for review)

### 4.0 Target architecture delta (one picture)

```
                                   ┌────────────────────────────────────────────┐
                                   │               OPERATIONS (new)             │
                                   │  /metrics (prom-client)   bull-board (adm) │
                                   │  pino structured logs ──► journald/file    │
                                   │  nightly: pg_dump + objects tarball ──► S3 │
                                   └──────▲───────────────▲─────────────────────┘
                                          │               │
┌──────────┐   session cookie   ┌─────────┴─────┐   ┌─────┴──────────┐    ┌─────────────┐
│ Browser  │◄──────────────────►│  apps/web     │   │  apps/worker   │───►│ Telegram/   │
│ (+ ext.) │  SSE /tasks stream │  Next.js      │   │  BullMQ        │    │ Email       │
└────┬─────┘                    │  · rate-limit │   │  · heartbeat ──┼──► Redis key     │
     │ ext. token (§4.7)        │    ALL costly │   │  · lifecycle   │    (watched by   │
     │                          │    routes     │   │    hooks (§4.2)│     web /health) │
     │                          │  · origin+CSP │   └───┬────────────┘
     │                          └───┬───────────┘       │
     │                              │                   │
     │                        ┌─────▼──────┐      ┌─────▼──────┐
     │                        │  Postgres  │      │  Objects   │
     │                        │  +pg_trgm  │      │  local/S3  │
     │                        │  +tsvector │      └────────────┘
     │                        │  (+pgvector later)
     │                        └────────────┘
```

### 4.1 Observability (NEW-05/06) — effort M, no new infra required

- `@jobradar/log`: pino child loggers with `{app, queue, taskId, userId?, jobId?}`; redaction paths
  (`resume`, `content`, `prompt`, `description`); drop-in `log.info/warn/error` replacing `console.*`
  mechanically (codemod).
- `prom-client` default registry exposed at `/metrics` (admin/token): queue depth+failed (reuse the health
  counters), fetch outcomes by host, LLM calls/cost/latency by purpose, render success ratio, HTTP p95.
- **Heartbeat**: worker `SETEX worker:heartbeat 90 <ts>` every 30 s from the maintenance worker *and* a
  bare `setInterval` (so a wedged queue still distinguishes process-alive vs queues-stalled);
  `/api/health` paints red + fires the existing ops-Telegram *from the web side* when stale.
- Optional Sentry DSN env for both apps (error events only, redacted).

### 4.2 Data-lifecycle hooks (NEW-01/08/22) — effort S–M

```
ErasureRegistry (packages/db)
  onUserDeleted(userId)      → embeddings(profile:userId, resume_version:{ids}), objects prefix, tasks
  onResumeDeleted(ids)       → embeddings(resume_version), rendered files
  onJobsClosed/Deleted(ids)  → embeddings(job), vector-index eviction, job_fits (cascade already)
call sites: DELETE /api/me · ResumeService.delete · RetentionService.run · liveness close path
tests: erasure integration test with EMBEDDING_PROVIDER=fake asserting zero rows across ALL tables
```
Plus: `Embedding.updatedAt` column; `JobVectorIndex` pages on `updatedAt` and holds a `Map<jobId|chunk>`
with explicit `evict(jobIds)`; retention deletes job embeddings 30 d after `closedAt`.

### 4.3 Packaging, backup, DR (NEW-02/05) — effort M

- Dockerfiles (web: standalone Next output; worker: node+playwright base) + compose `app` profile;
  systemd units for the bare-metal path (`Restart=always`, `WatchdogSec` fed by the heartbeat).
- `tools/backup/backup.sh`: `pg_dump -Fc` + tar of `STORAGE_LOCAL_ROOT` → restic/rclone target; retention
  7 daily / 4 weekly; `restore.sh` + a CI job that restores the latest dump into a scratch DB and runs
  `prisma migrate status` (backup *tested*, not assumed).
- Runbook: upgrade = `migrate deploy` before rolling worker→web; rollback notes per migration.

### 4.4 Account lifecycle (NEW-07) — effort M

```
POST /api/auth/password {current,next}   → re-verify, rehash, delete other sessions
POST /api/auth/reset-request {email}     → single-use token (sha256 in DB, 30 min TTL) via existing SMTP
POST /api/auth/reset {token,next}
GET  /api/auth/sessions · DELETE /api/auth/sessions/:id   (table already has UA/IP/lastSeen)
login: per-account counter (5/15min) + per-IP (existing); absolute session age cap 90 d
signup (if ever enabled): email verification token before first login
```

### 4.5 Multi-user readiness (NEW-03) — effort M, behind a flag

- `job_user_descriptions(userId, jobId, text, createdAt)`; analysis resolves description as
  `user override → shared`. Shared `jobs.description` is only written by crawler/hydrator (provenance kept).
- `alert_channels(userId, kind telegram|email, address, classes[], enabled)`; notify worker fans out per
  user; current env vars become the seed row for the owner.
- Ranking: `rankingScore` stays global (base quality); the *personal* layer is already per-user
  (`job_fits`, matchScore) — remove the `findFirst` profile from the global ranking pass.

### 4.6 Search index (NEW-09/GH-2) — effort M

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX jobs_title_trgm   ON jobs USING gin (title gin_trgm_ops);
CREATE INDEX jobs_company_trgm ON jobs USING gin (company gin_trgm_ops);
ALTER TABLE jobs ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || coalesce(description,''))) STORED;
CREATE INDEX jobs_tsv ON jobs USING gin (search_tsv);
```
`/api/jobs?q=` becomes: `websearch_to_tsquery(expandedTerms)` ∪ trigram title/company ∪ semantic kNN,
fused with the existing RRF. API shape unchanged; `expandQuery` still feeds recall.

### 4.7 C12 browser extension (feasibility + HLD)

```
┌─────────────── Chrome/Firefox MV3 extension ───────────────┐
│ content script (greenhouse|lever|ashby|workable field maps)│
│   └─ detects ATS form → "Fill from JobRadar" button        │
│ service worker ── fetch ──► https://jobradar.local/api/ext │
└──────────────┬─────────────────────────────────────────────┘
               │  Authorization: Bearer <extension token>
   ┌───────────▼───────────────────────────────┐
   │ apps/web  /api/ext/* (CORS: ext origin)   │
   │  GET /api/ext/apply-kit?url=<page url>    │  ← resolves job by applyUrlNormalized
   │  → profile basics, applyDefaults, answers,│
   │    chosen ResumeVersion file (signed URL) │
   └───────────────────────────────────────────┘
Flow: user opens the ATS page → extension matches URL → fills name/email/phone/links/answers,
attaches the tailored PDF → USER clicks Submit → extension POSTs "mark applied {resumeVersionId}".
```
Feasibility: high. Pre-reqs from this audit: token auth (NEW-07 infra), CORS allow-list, rate limits
(NEW-04). Field maps for GH/Lever/Ashby/Workable cover the corpus; Workday excluded (iframe/shadow-DOM
churn). No ToS conflict: no automated submission. Effort L (2–3 weeks) as already estimated in C12.

---

## 5. Suggested sequencing

| Wave | Items | Effort |
|---|---|---|
| 1 (this week) | NEW-01 erasure, NEW-02 backup script+runbook, NEW-10 health token, NEW-15 AUTH_DISABLED guard, NEW-17 `.gitignore data/` | ~3 d |
| 2 | NEW-04 rate limits + inline budget, NEW-05 heartbeat+alert, NEW-06 logging/metrics, NEW-12 headers | ~1 wk |
| 3 | NEW-07 account lifecycle, NEW-08 vector lifecycle, NEW-09/GH-2 search index, NEW-13/14 | ~1.5 wk |
| 4 | NEW-03 multi-user readiness (flagged), GH-1 SSE, GH-3 bull-board, GH-5 follow-ups | ~1.5 wk |
| 5 | GH-9/C12 extension, GH-4 OpenAPI, GH-7 export, NEW-19 harness restore | 2–3 wk |
