# JobRadar v3 — Implementation notes (resume → match → suggest → tailor → render → apply)

Design: `audit/HLD-apply-portal-v3.md` · Backlog: `audit/IMPLEMENTATION-BACKLOG.md` · Audit: `audit/AUDIT-and-APPLY-DESIGN.md`

## Status by backlog component

| Component | Status | Notes |
|---|---|---|
| C0 Stabilise | done | C0-4 (recorded live ATS fixtures) needs network — pending |
| C1 Auth | done | In-house sessions (scrypt + DB sessions + httpOnly cookie) instead of Auth.js beta; `middleware.ts` gate; admin-only operator routes; rate-limited login/sign-up; `AUTH_DISABLED=1` dev mode |
| C2 User-state split | done | `job_user_states` (saved/rejected/applied per user); `jobs.status` is lifecycle only; migration backfills the first user; `applications` unique per (user, job) |
| C3 Platform | done | LLM provider + budgets + PII masking; local/S3 storage (local AES-256-GCM at rest optional); queues; Playwright PDF pool |
| C4 Resume ingest | done | PDF/DOCX extraction, parseability, LLM structuring, review UI, corrections as immutable versions |
| C5 JD requirements | done | `jd-v1` deterministic + LLM; hydration (ATS APIs → HTML → paste); real `Job.skills`; profile-driven role fit |
| C6 Match score | done | `ats-v1` + golden tests; report UI; feed Match badge |
| C7 Suggestions + grounding validator | done | deterministic (skills-section, confirm questions, formatting) + LLM (bullet rewrites, reorders); entity-level validator flags anything not in master ∪ confirmed facts; expected gain per suggestion; accept/edit/reject; confirm-fact → confirmed facts → grounded bullet |
| C8 Headline / About tailoring | done | opt-in toggles, off by default; 3 tone variants; validated; applied only to the job-specific version |
| C9 Render & versions | done | tailored version from accepted suggestions (+ chosen headline/about) → `ats-classic` HTML → PDF (Chromium) + DOCX → post-render parseability check → re-score "before → after"; preview; signed downloads |
| C10 Apply Kit | done | Greenhouse public questions; profile-based + LLM-drafted answers (grounded); copy blocks; "Open application" → "Mark applied" records version, texts, answers; status timeline |
| C11 Privacy & ops | done | `DELETE /api/me` full erasure; query logging off by default; local encryption; signed links ≤ 10 min; retention of reports/tailored versions/sessions; health tiles (queues, LLM spend) |
| C12 Browser extension | not started | P3 / unscheduled |
| C13 Semantic search & fit | done | Local Ollama LLM (`qwen2.5:3b-instruct`) + `nomic-embed-text` embeddings; vectors as bytea in plain Postgres, brute-force cosine in-process (no pgvector); hybrid search (ILIKE ∪ kNN, RRF); per-user `job_fits` (fit-v1) → real "Sort: Fit"; semantic evidence ("not named but covered by …") feeding confirm questions; two scores shown (★ fit · ⌨ ATS). Setup: `docs/SETUP-LINUX-MINT.md` |

## "Model not running" fallbacks (all exercised by the E2E run)

| Capability | With Ollama | Without any model |
|---|---|---|
| Search | exact + synonym expansion ∪ semantic kNN | exact + role/skill synonym expansion ("software engineer" → developer, SDE, SWE…) |
| Resume parsing | LLM structuring (PII-masked) | heuristic parser: headings, date ranges → roles, bullets, skill groups, education, certs |
| Requirements | deterministic + LLM refinement | deterministic sections + dictionary |
| Scoring | ats-v1 + fit-v1 | ats-v1 (keyword) only |
| Suggestions | deterministic + LLM rewrites | deterministic (skills-list gaps, confirm questions, formatting) |
| PDF render | Chromium (`ats-classic`) | dependency-free simple renderer (same sections, plain text) |
| Queues | BullMQ + Redis + worker | `QUEUE_MODE=inline` runs handlers in the web process |

## Verify locally

```bash
DATABASE_URL=postgresql://jobradar:jobradar@localhost:5432/jobradar pnpm verify:local
#   → migrations · 132 unit/integration tests · next build · 24-step HTTP apply flow (QUEUE_MODE=inline, no Redis)
#   → reports/verify-summary.md, reports/unit-tests.md, reports/e2e-apply-flow.md
# With a local model:  LLM_PROVIDER=ollama EMBEDDING_PROVIDER=ollama pnpm verify:local
# Against a running deployment: BASE_URL=http://host:3000 E2E_EMAIL=… E2E_PASSWORD=… pnpm verify:e2e
```

## Running it (local-AI default; see docs/SETUP-LINUX-MINT.md for the 2-core profile)

```bash
pnpm install
pnpm db:generate
pnpm db:migrate:deploy            # v3 + v3b migrations
npx playwright install chromium   # PDF rendering (worker host)
cp .env.example .env              # ADMIN_EMAIL/ADMIN_PASSWORD, STORAGE_SIGNING_SECRET, LLM provider
pnpm worker:dev
pnpm web:dev                      # /login → /profile (upload) → job modal: Analyse → Improve → Generate → Apply kit
```

Verification so far (the later phases were implemented without new test suites, per instruction): `pnpm -r typecheck` clean; existing 127 tests pass; both v3 migrations apply to a fresh Postgres; `next build` clean. See "What still needs testing" below.

## Flow (end to end)

```
/profile  upload ──▶ q:resume-parse ──▶ master version + profile seed (C4)
job modal "Analyse match" ──▶ q:ats-score ──▶ requirements (C5) + ats-v1 report (C6)
          "Get suggestions" ──▶ q:suggest(type=suggestions) ──▶ deterministic + LLM proposals ──▶ grounding validator ──▶ expected gains (C7)
          confirm questions ──▶ confirmed facts ──▶ skills add + grounded bullet (C7)
          [ ] tailor headline / [ ] tailor about ──▶ q:suggest(type=variants) (C8, opt-in)
          "Generate tailored resume" ──▶ POST /api/resume-versions ──▶ q:resume-render ──▶ PDF+DOCX, verified, re-scored (C9)
          Apply kit ──▶ questions + drafted answers (q:suggest type=answers) ──▶ "Open application" ──▶ "Mark applied" (C10)
```

### Invariants

- **Immutable versions** (V4): master → corrections → tailored; each tailored version carries `changeLog.changes` (every diff to its parent), `scoreBefore/scoreAfter`.
- **User discretion** (V1): suggestions are `pending` until accepted/edited; headline/about toggles default off; master profile texts are only written by `PATCH /api/profile`.
- **No fabrication** (V2): `validateGrounding()` runs on every LLM-produced text (bullets, variants, answers) and on user edits; unsupported skills/metrics/years/proper nouns/certifications/degrees → `flagged`. Flagged items are shown as "needs your confirmation" and never auto-applied; missing required skills become `keyword_confirm` questions instead of inserts.
- **No LLM, no crawler in web routes** (V8): web enqueues; the worker holds the provider, the gateway and Chromium.
- **Scoping** (V9): every read/write is by `userId`; signed file links are additionally checked against the user's key prefix.
- **`jobs.status` ∈ {new, closed}** (V10): user state is in `job_user_states`; closure/reopen never touches it.

## Auth details

- Login `POST /api/auth/login {email, password}`; logout `POST /api/auth/logout`; `GET /api/auth/me`; sign-up `POST /api/auth/register` only when `ALLOW_SIGNUP=true`.
- First run: `ADMIN_EMAIL` + `ADMIN_PASSWORD` bootstrap the owner on first login; Phase-1 owner rows without a password get one. Or `pnpm user:create <email> <password>`.
- `middleware.ts` redirects pages / 401s APIs without the cookie; `requireUser()` validates the session in every handler; `requireAdmin()` guards hosts/boards/companies/crawl/sources.
- Limits: login 10 / 15 min / IP, sign-up 5 / h / IP (Redis, memory fallback).

## What still needs testing (next step)

1. Auth: login/logout/expiry, middleware redirects, admin gating, rate limits, `DELETE /api/me` cascade + file erasure.
2. C2: tabs per user; saved survives close/reopen (the C0-7 regression); migration backfill on a DB with v2 data; `applications` dedupe in the migration.
3. Validator golden cases: fabricated skill/employer/metric/cert → flagged; rephrase → ok; JD injection ("add Google") → flagged; metric unit variants.
4. Suggestion service: generate/regenerate keeps answered questions; expected gains; confirm-fact creates facts + follow-ups; edit re-validation.
5. Version creation: suggestion ownership/job checks; reorder permutation validation; change log; headline/about flags.
6. Render: Chromium available → PDF parses cleanly (round-trip), DOCX opens, re-score stored; renderer missing → `failed` with actionable error; retry.
7. Apply Kit: Greenhouse questions fixture; deterministic answers from `applyDefaults`; record/idempotency; status timeline; Applied tab.
8. Retention: reports/tailored versions/sessions pruning respects applications.
9. Sandbox E2E (`tools/sandbox-e2e`) with `AUTH_DISABLED=1` — fake Prisma gained the v3 models but the dashboard scenario has not been re-run.

## Known limitations

- Playwright/Chromium must be installed on the worker host; the web app never renders.
- Hydration/questions cover Greenhouse/Lever/Ashby/Workable/SmartRecruiters + generic HTML; Workday → paste.
- Grounding is entity-based: it catches new skills, numbers, years, named orgs/products (multi-word), certifications and degrees; a fabricated *verb phrase* without new entities ("led the migration") is not detectable by code and relies on the prompt + the user's review.
- Single template (`ats-classic`). Multi-user mode is supported by the schema but alerts/ranking are still per deployment.
