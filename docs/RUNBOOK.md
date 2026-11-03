# JobRadar — Operations runbook (v4)

Covers: deploy, upgrade, backups & restore, alerting, logs & metrics, account recovery, multi-user switch.
Companion docs: `IMPLEMENTATION-v4.md` (what changed and why), `docs/openapi.json` (API), `.env.example`.

## 1. Topology

```
browser ──► web (Next.js :3000) ──► Postgres 16 (+pg_trgm)      worker (BullMQ) ──► Redis
                                 └──► Redis (sessions are in PG; Redis = queues, rate limits, budgets, heartbeat)
                                 └──► object store (local ./data/objects | S3/MinIO)
                                                                 worker ──► Ollama (optional) · Chromium (PDF)
```
Either tier can run without the other for a while: the web tier serves and enqueues; the worker crawls,
alerts, parses, renders. `/api/health` shows the worker heartbeat; stale > 3 min = red + Telegram ops alert.

## 2. Deploy

### Docker (recommended)
```bash
cp .env.example .env   # fill ADMIN_EMAIL/ADMIN_PASSWORD, STORAGE_SIGNING_SECRET, TELEGRAM_*, APP_URL
docker compose --profile app up -d --build          # postgres, redis, web (runs migrations), worker, nightly backup
docker compose --profile app --profile ai up -d     # + Ollama
```
The web container runs `prisma migrate deploy` on start; the worker starts after the web service.
Backups land in `./backups` (mount an off-box path in production; set `BACKUP_PASSPHRASE`).

### Bare metal (systemd)
```bash
sudo cp deploy/systemd/*.service deploy/systemd/*.timer /etc/systemd/system/
sudo systemctl enable --now jobradar-web jobradar-worker jobradar-backup.timer jobradar-restore-drill.timer
```
Put the app under a TLS-terminating proxy (Caddy/nginx) and set `TRUSTED_PROXY=1` so rate limits see real IPs.

### Upgrade
1. `tools/backup/backup.sh` (always before a migration).
2. `pnpm install --frozen-lockfile && pnpm db:generate && pnpm db:migrate:deploy`.
3. Restart worker, then web. Check `/health` → Worker tile green, no red alerts.
4. If `prisma migrate dev` (development only) reports drift on `jobs.search_tsv`: it is a `GENERATED` column
   Prisma cannot express; `prisma migrate resolve --applied 20260901000000_v4_hardening` after reviewing.

## 3. Backups & restore (audit NEW-02)

| What | How | Where |
|---|---|---|
| Nightly backup | `tools/backup/backup.sh` (cron/systemd timer/compose `backup` service) | `$BACKUP_DIR/{daily,weekly}/<stamp>/` — `db.dump` (pg_dump custom), `objects.tgz`, `manifest.json`, `SHA256SUMS`; `.enc` when `BACKUP_PASSPHRASE` is set |
| Off-box copy | `BACKUP_REMOTE=s3:bucket` (rclone) | — |
| Restore | `tools/backup/restore.sh <dir> [--db URL] [--objects PATH] [--yes]` then `pnpm db:migrate:deploy` | refuses a non-empty DB without `--yes` |
| Restore drill | `tools/backup/verify.sh` weekly (timer) and in CI on every push | restores the newest backup into a scratch DB and migrates it |
| Dead-man's switch | `HEALTHCHECK_URL` pinged after each successful backup | silence = backups stopped |

RPO = 24 h by default (raise the cron frequency for less). S3 storage: rely on bucket versioning + replication
for objects; the script still dumps the database.

## 4. Alerting & health

- **Job alerts**: per-user channels under *Profile → Account & alerts* (`alert_channels`). With no rows, the
  `TELEGRAM_CHAT_ID` / `EMAIL_TO` env vars act as the owner's channel (single-user install unchanged).
- **Ops alerts** (Telegram `TELEGRAM_OPS_CHAT_ID`): blocked hosts, 429 rates, circuit open, failed-queue
  thresholds (from the worker) and **worker down** (from the web tier, deduped hourly).
- **Follow-up reminders**: daily 09:00 IST for applications whose `followUpAt` is due (set when marking applied).
- `/api/health` for humans (admin) and monitors (`x-health-token: $HEALTH_TOKEN`, timing-safe).
- `/api/metrics` (web) and `:9464/metrics` (worker): Prometheus text; `:9464/healthz` for the process manager.
  Key series: `jobradar_queue_depth`, `jobradar_queue_jobs_total`, `jobradar_llm_calls_total`,
  `jobradar_llm_cost_usd_total`, `jobradar_fetch_total`, `jobradar_rate_limited_total`,
  `jobradar_worker_heartbeat_timestamp_seconds`, `jobradar_log_events_total{level}`.
- Queue dead letters: *Health → Queues* (retry / remove / clean) or `GET/POST /api/admin/queues`.

## 5. Logs

Structured JSON in production (`LOG_FORMAT=json`), pretty in dev. Fields: `level, time, msg, app, queue,
taskId, userId, jobId, err{name,message,code}`. Sensitive keys (resume content, descriptions, prompts,
passwords, tokens, e-mail, phone…) are redacted by key name before they reach stdout. `LOG_LEVEL=debug`
for dispatch/poll chatter. Ship with journald/vector/promtail; no log pipeline is required for alerting
because every record also increments `jobradar_log_events_total`.

## 6. Accounts

| Task | How |
|---|---|
| First admin | `ADMIN_EMAIL` + `ADMIN_PASSWORD` in `.env` → first login creates it; or `pnpm user:create` |
| Forgot password | Login page → "Forgot password?" → e-mail link (30 min, single use) → all sessions revoked |
| Change password | Profile → Account → Password (revokes other sessions) |
| Sign out everywhere | Profile → Account → Active sessions |
| Locked out (8 failed logins / 15 min per account) | wait, or `redis-cli del auth:fail:<email>` |
| Self sign-up | `ALLOW_SIGNUP=true`; add `SIGNUP_REQUIRE_VERIFICATION=true` + SMTP for verified e-mails |
| Erase an account / export data | Profile → Account → Your data (`DELETE /api/me`, `GET /api/me/export`) |
| Extension / API token | `auth_tokens.kind=extension` rows (issuance UI arrives with C12); sent as `Authorization: Bearer` |

`AUTH_DISABLED=1` is ignored in production unless `AUTH_DISABLED_I_KNOW_WHAT_I_AM_DOING=1` is also set.

## 7. Turning on multi-user

Before `ALLOW_SIGNUP=true` on a shared box:
1. Configure your own alert channel(s) under Profile → Account & alerts (otherwise every user's alerts go to the env chat).
2. Set `SIGNUP_REQUIRE_VERIFICATION=true` and SMTP.
3. Know that the **global** base ranking stops using any single profile once there is more than one user
   (personal ranking = match/fit scores); that is by design.
4. User-pasted job descriptions are stored beside the crawled text with provenance and only used when the
   crawled text is unusable; the UI labels them. A later crawl/hydration takes precedence automatically.

## 8. Incident quick reference

| Symptom | Check | Fix |
|---|---|---|
| Health: "WORKER DOWN" | `systemctl status jobradar-worker` / `docker compose ps` · `:9464/healthz` | restart; read the last `level=error` lines |
| Tasks stuck at "Waiting for worker…" | Worker tile; `jobradar_queue_depth{state="waiting"}` | worker down or LLM lane saturated (`LLM_CONCURRENCY`) |
| Ollama down | Health → Ollama tile | `ollama serve`; deterministic features keep working |
| 429 on analysis/upload | user hit `RATE_*` | raise the env limit, or wait for the window |
| 503 `queue_full` (inline mode) | `INLINE_MAX_PENDING` | wait, or run a real worker + Redis |
| Search returns ILIKE results only (`fts:false`) | migration v4 applied? | `pnpm db:migrate:deploy`; FTS re-probes every 10 min |
| Backup failed | `HEALTHCHECK_URL` alarm / `backup.log` | disk space, `pg_dump` in PATH, passphrase |

## 9. Dynamic preferences (v5)

- Each user's inbox, score, alerts and digest come from **their** document (`/preferences`); jobs are evaluated
  once per (user, job) into `job_user_evals`. New users get the `legacy-india-remote` shape with their resume
  skills and the first-run wizard; the owner was seeded from the old env values on upgrade.
- A save re-evaluates that user's open jobs in the worker (`prefs-reeval`, idempotent per version). Progress
  streams to the page; the inbox keeps serving meanwhile.
- `PREFS_ENGINE=legacy` switches feed/alerts/tiering back to the owner-centric classes (A/B only).
- Crawl scope is the union of users (Health → "Preferences engine"): intersection of excluded HQs, lowest pay
  floor (USD), all home metros. Workday scope suggestions apply automatically on a single-user box; admins
  apply them from Health otherwise.
- Fan-out cap: users inactive for `PREFS_ACTIVE_DAYS` (90) are not evaluated for new jobs; their next
  sign-in + save (or `PUT /api/preferences`) catches them up.
- Digest runs hourly and serves each recipient at `alerts.digestHour` in their timezone (env fallback 08:00 IST).

## 10. Browser autofill extension (C12)

### Local test, fully in the sandbox (no real ATS, no network)
```bash
tools/sandbox-e2e/setup.sh                                     # links playwright + shims
tsx tools/testkit/run-tests.ts e2e-extension-api tools/sandbox-e2e/extension-api.test.ts   # API contract (fake DB)
node tools/extension-e2e/run.mjs                               # real extension in headless Chromium
```
The second command starts a local server with Greenhouse/Lever/Ashby/Workable fixture forms and a mock
`/api/ext/*`, loads `apps/extension` unpacked, pairs it, fills every fixture, attaches the PDF, checks that no
submit happened and that "mark applied" posts the right artifacts. Report: `reports/extension-e2e.md`.

### Manual test against your running JobRadar
1. `pnpm web:dev` (or the Docker stack) and sign in.
2. Profile → Account & alerts → Browser extension → *Create pairing token* (copy it).
3. Chrome: `chrome://extensions` → Developer mode → Load unpacked → `apps/extension`.
4. Extension → options → URL `http://localhost:3000` + token → *Save & test connection* → "Connected as …".
5. Open a job in JobRadar → Tailor & Apply → *Open application ↗* (Greenhouse/Lever/Ashby/Workable).
6. Extension icon shows ✓/•/○ → popup → *Fill this form* → fields turn green; check values, attach if reported.
7. Submit on the employer's site → popup → *I submitted — mark applied* → the job moves to Applied in JobRadar
   with `submittedVia = extension`.
8. Automated variant against the live app: `MOCK_BASE=http://localhost:3000 TOKEN=<token> node tools/extension-e2e/run.mjs`
   (fixtures are still local pages; the kit/file/applied calls hit the real API — expect "profile-only" unless a
   job's apply URL matches the fixture URL).

### Security notes
Bearer tokens (180 d, ≤5 per user, revocable in the same card) are stored only in `chrome.storage.local`.
`/api/ext/*` never accepts cookies; CORS is restricted to extension origins (`EXTENSION_ORIGINS` to extend).

## 11. Visual resume editor

`/resumes/<resumeId>/edit` (from Profile → Resumes → *Edit*) edits the master: saves a **correction** version.
`/resumes/<resumeId>/edit?job=<jobId>&base=<versionId>` (from a job's Tailor tab → *✎ Open in editor*) edits
for a job: live ATS score, matched/missing chips and the pending suggestions with **Apply / Undo / Reject** and
their gain recomputed on the current draft; saves a **tailored** version, renders it and re-scores it, and the
Apply Kit picks it up. Drafts autosave to the browser (localStorage) until saved or discarded.

Manual test:
1. Upload a resume (Profile), open a job, run *Analyse match*, *Get suggestions*.
2. Tailor tab → *✎ Open in editor*. The score ring shows `base → draft (+0)`.
3. Edit a bullet in *Experience* → the preview re-renders and the score/chips update as you type.
4. Click *Apply* on a suggestion → the field changes, the score jumps by the shown gain, the entry moves to
   "Applied in this draft" with *undo*.
5. Type a skill you never used into a bullet → an amber "not in your master resume" flag appears next to the
   field and in the rail (your words are still saved; the flag is stored in the change log).
6. *Save as tailored version* → progress (render, verify, re-score) → redirected to the job; the Apply Kit
   shows the new version with its score; the master is unchanged.

Automated: `tsx tools/testkit/run-tests.ts e2e-editor tools/sandbox-e2e/editor.test.ts` (route → inline
render → real PDF parsed back → re-score → Apply Kit) and the unit tests in `packages/resume/src/version/editor.test.ts`
and `apps/web/lib/resume-editor.test.ts` (draft reducer, apply/undo, live score, gains, persistence).

## 12. UI v8 — where things are now

| I want to… | Go to |
|---|---|
| See new postings, save / dismiss, analyse, tailor, apply kit | **Inbox** `/` (tabs: Inbox · Saved · Not interested · Closed; `?job=<id>` deep-links a posting) |
| Track everything I applied to | **Applications** `/applications` (drag cards between stages; click a card for the full detail) |
| Upload / review / edit resumes | **Resumes** `/resumes` → *Edit* opens `/resumes/<id>/edit` |
| Change headline, about, skills, apply defaults | **Profile** `/profile` |
| Change tiers, home metros, pay floor, presets | **Preferences** `/preferences` |
| Password, sessions, alert channels, extension pairing, export / erase | **Account** `/account` |
| Ops (admins only) | **Admin → Overview** `/admin`, **Companies** `/admin/companies`, **Sources & hosts** `/admin/sources`, **Queues** `/admin/queues` |

Old URLs still work: `/health → /admin`, `/watchlist → /admin/companies`. `/admin/*` is server-gated
(`app/admin/layout.tsx`): non-admins land on `/`, signed-out users on `/login?next=…`.

Visual check without a build: `node tools/ui-smoke/run.mjs` (after `tools/sandbox-e2e/setup.sh`) renders every
page with the real components, the real API routes and the real Tailwind CSS in headless Chromium and stores
screenshots under `reports/ui-smoke/`. `KEEP=1` leaves the seeded server on `http://127.0.0.1:18100` for poking.

## 13. One entry point: `./jobradar`

| Command | What it does |
|---|---|
| `./jobradar up` | doctor → plan (printed) → execute (env, infra, deps, migrate, seed, models, Chromium, build) → supervise web + worker (+ managed Ollama). Flags: `--mode auto\|native\|docker\|lite`, `--prod`, `--ai <choice>`, `--admin <email>`, `--yes`, `--dry-run`, `--skip-install`, `--skip-chromium`, `--keep-infra` |
| `./jobradar down` | SIGTERM the supervised tree (30 s drain), stop compose services it started (unless `--keep-infra`) |
| `./jobradar status` | launcher/child pids, health probes, URL |
| `./jobradar doctor` | prerequisites + reachability table and the plan it would run; exit 1 when it would refuse |
| `./jobradar logs [web\|worker\|ollama]` | tail `.jobradar/logs/*.log` |
| `./jobradar ai setup\|test` | write the provider block to `.env` / probe every configured provider (docs/AI-PROVIDERS.md) |
| `./jobradar systemd` | print a single unit that runs `up --prod` (replaces the two units in `deploy/systemd`) |

Behaviour to know: restarts use exponential backoff (1 → 30 s) and give up after 10 crashes in 10 minutes (the
launcher exits 1 so systemd/compose take over); health probes (`/login`, worker `/healthz`) restart a child
after three consecutive failures; first-run secrets are written to `.env` and the admin password is printed once;
fallbacks for this run only (Redis down → inline, Ollama missing → AI off, port 3000 busy → 3001) are **not**
persisted to `.env`. State lives in `.jobradar/state.json`.

`pnpm start` / `pnpm up` / `pnpm down` / `pnpm doctor` are aliases.
