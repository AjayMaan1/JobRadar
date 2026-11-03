# Verification guide

Two ways to verify, depending on what you have available.

| Mode | Needs | Verifies | Command |
|---|---|---|---|
| **A. Offline / sandbox** | Node 22, `tsx`, optional Postgres, Playwright Chromium | Migration SQL on real Postgres · 215 unit/regression tests (incl. launcher planner/supervisor and AI provider chain) · E2E suites (pipeline 16, preferences 5, extension API 6, editor 4) · real extension in Chromium (11) · **UI smoke: real pages + real API routes + real Tailwind in Chromium (19 steps, screenshots)** | `tools/sandbox-e2e/run-all.sh` |
| **B. Full stack (local)** | `./jobradar up` (Docker or local Postgres/Redis; pnpm) | Everything above under real vitest, plus the live worker polling real ATS boards and the Next.js dashboard | `./jobradar up` then §B |

Reports land in `./reports/` in both modes.

---

## A. Offline / sandbox verification (what was run here)

```bash
# from repo root — no network, no node_modules required
export PGHOST=/path/to/pg-socket-or-host PGUSER=jobradar   # optional; enables the migration check
tools/sandbox-e2e/run-all.sh
```

What it does:

1. `tools/sandbox-e2e/setup.sh` links workspace packages + `tools/testkit/shims` into `node_modules` (sandbox only).
2. **Migration check** — applies all three migrations to a fresh database with `psql -v ON_ERROR_STOP=1`.
3. **Unit + regression** — `tsx tools/testkit/run-tests.ts unit-tests <files>` → `reports/unit-tests.{md,json}`.
4. **E2E** — `tsx tools/testkit/run-tests.ts e2e-sandbox tools/sandbox-e2e/e2e.test.ts` → `reports/e2e-sandbox.{md,json}`, `reports/e2e-artifacts.md` (dashboard rows, Telegram messages, digest, health JSON, outbound request counts), `reports/dashboard-sample.json`.
5. **More E2E** — `prefs.test.ts`, `extension-api.test.ts`, `editor.test.ts` (each in its own process), then `node tools/extension-e2e/run.mjs` (real MV3 extension in headless Chromium).
6. **UI smoke (v8)** — `node tools/ui-smoke/run.mjs`: esbuild bundle of the real page components + real `globals.css` compiled with Tailwind 3.4 + `/api/*` bridged to the real route handlers over a seeded in-memory DB, driven in Chromium at 1440 px and 375 px → `reports/ui-smoke.md`, `reports/ui-smoke/*.png`.

Run pieces individually:

```bash
tools/sandbox-e2e/setup.sh
tsx tools/testkit/run-tests.ts unit-tests packages/extractor/src/classifier.test.ts        # one file
tsx tools/testkit/run-tests.ts e2e-sandbox tools/sandbox-e2e/e2e.test.ts                   # E2E only
```

### What the E2E scenario covers

| # | Scenario | Asserts |
|---|---|---|
| 1 | Dispatcher | due boards claimed in tier order; second claim returns nothing (lease) |
| 2 | First poll | Greenhouse/Lever/Workday(scoped) engines → sightings → enrich; P1/P2/P3/none/internship classified with reasons; salary parsed to INR; irrelevant titles dropped pre-extraction |
| 3 | Alerts | P1+P2 instant with class tag; P3/none/internship not; 12 P1 on one board → 10 sent + 2 deferred; detail fetched exactly once; pay evidence recorded |
| 4 | Dashboard | `/api/jobs` browse = eligible classes only, newest-first, freshness at read time; class/company filters; `/api/health` counts |
| 5 | Unchanged poll | `If-None-Match` sent → 304 → no enrich, no alert |
| 6 | New posting | exactly one new alert; time-to-detect sample recorded |
| 7 | Closure | gone after 2 polls (incl. an *unchanged* poll) → `status=closed`, hidden from browse, in Closed tab; reappearance reopens without re-alert |
| 8 | Suspect drop | >50 % shrink suspends closures |
| 9 | Rate limit | 429 + Retry-After → host circuit open → next poll skipped with zero HTTP |
| 10 | Digest | P3 + deferred; instant-alerted excluded |
| 11 | Aggregator dedupe | Remotive job with ATS apply URL matches existing job by URL; discovery row created |
| 12 | Aggregator-only job | created + alerted; liveness closes it on 404 after 14 d |
| 13 | Tiering | hot/warm/dormant derived; NCR office detected; anchors exempt |
| 14 | Discovery → resolver → probe | careers HTML with embedded Greenhouse script → board → probe (no alerts) → watched |
| 15 | Retention | old fetch_runs and long-gone sightings pruned; live sightings kept |
| 16 | Politeness | JobRadar UA on every request; robots.txt honoured for HTML; budgets tracked |

### Bugs found and fixed by this run

- Relevance filter regex `\bback[- ]end\b` rejected one-word "Backend"/"Frontend" titles → P1 roles silently dropped.
- Closure stalled at `missing_count=1` because the poll after a removal is `unchanged` (stable list) → added `confirmMissing()` on unchanged polls.
- Prober ran tiering before enrichment landed → fresh companies demoted to dormant → tiering now waits ≥1 h after probe.
- Health counters included internships (feed excludes them).
- Re-sighting with list-level data erased salary/description/class captured from the detail fetch → merge now keeps richer fields.
- `dedupe.ts` variable shadowing (would not compile).

---

## B. Full-stack verification (your machine)

```bash
# 0. infra
docker compose up -d postgres redis
cp .env.example .env            # fill TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, CONTACT_URL/EMAIL, SMTP_* (optional)

# 1. deps + client + schema + seed
pnpm install
pnpm db:generate                # regenerates the Prisma client (mandatory)
pnpm db:migrate:deploy          # applies packages/db/prisma/migrations/*
pnpm db:seed                    # sources, host policies, 55 anchors, legacy ATS slugs
pnpm typecheck

# 2. tests under real vitest (same files as the sandbox run)
pnpm test                       # unit + regression → reports/vitest-unit.json
pnpm test:e2e:sandbox           # simulated E2E via vitest aliases → reports/vitest-e2e-sandbox.json

# 3. live run
pnpm worker:dev                 # in one terminal — watch for: resolve-sweep → probe → dispatch → [enrich] NEW p1_…
pnpm web:dev                    # http://localhost:3000  (Jobs · Watchlist · Health)
```

What to look for live (first ~15 minutes):

1. Worker log: `Schedules configured …`, then `[resolve] resolved=N`, `[probe] board … → changed (k items)`, `[dispatch] N boards due`, `[enrich] NEW p1_global_remote · <title> @ <company> · alert=sent`.
2. Telegram: `[P1] Global remote` / `[P2] India remote` messages for postings first seen *after* the probe.
3. http://localhost:3000 — Browse shows P1/P2/P3 chips, newest first; Watchlist shows anchors with boards and `lastSuccessAt`; Health shows per-host 304/changed/429/blocked counts, circuits, and time-to-detect.
4. http://localhost:3000/api/health — `counts.p1_24h`, `timeToDetect.medianMinutes`, `alerts: []`.

Expect a handful of anchor boards to show `not_found` on the Health page — the ATS slugs in `seeds/anchors.ts` are best-effort and are corrected there (or via the Watchlist "add by careers URL" form, which resolves the ATS automatically).

Manual checks:

```bash
pnpm crawl -- resolve           # resolve + probe without BullMQ
pnpm crawl -- boards            # poll due boards once
curl -s 'localhost:3000/api/jobs?class=p1_global_remote&sort=newest&limit=5' | jq '.data[] | {title, company, classReason, rankingScore}'
curl -s localhost:3000/api/health | jq '.counts, .timeToDetect, .alerts'
```
