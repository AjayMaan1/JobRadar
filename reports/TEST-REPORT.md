# JobRadar — verification report (v9, free-tier AI default)

Generated 2026-11-02T08:56:09Z · sandbox: Node v22.21.0, real Postgres 16 for migrations, in-memory Prisma/Redis doubles for
pipeline E2E, fixture HTTP for every external endpoint (ATS boards, Telegram, Cerebras, Gemini), headless Chromium (Playwright)
for the extension and the UI. No network.

## Completion outcomes

| # | Outcome | How it is verified | Result |
|---|---|---|---|
| 1 | **Dynamic user preferences** | Per-user preference document (`user_preferences`, versioned, `preference_history`) seeded from `CandidateProfile` skills/titles + env on first run; per-user `job_user_evals`; presets, preview, revert, crawl-scope union. `e2e-prefs` (5): two users see the same postings in different tiers, alerts fan out per user, preview/save/re-eval, history/revert, crawl scope. `ui-smoke` step 11: /preferences loads the doc (home, tiers, pay, presets, history). | ✅ 5/5 · UI ✅ |
| 2 | **Browser extension autofill** | `e2e-extension-api` (6): pairing, bearer auth, apply-kit by URL, mark-applied, revocation. `extension-e2e` (11): the REAL MV3 extension in Chromium fills Greenhouse/Lever/Ashby/Workable/generic fixture forms, attaches the PDF, never clicks submit, marks applied. | ✅ 6/6 + 11/11 |
| 3 | **Visual resume editor** (form ‖ live preview ‖ score rail) | `editor.test.ts` + `resume-editor.test.ts` (unit); `e2e-editor` (4): draft → tailored version via the real route → inline render → real PDF parsed back → re-score → Apply Kit; `ui-smoke` steps 9–10: headline edit re-renders the preview and counts "1 change", Apply on a suggestion updates the live score. | ✅ 4/4 · UI ✅ |
| 4 | **Clean User vs Admin UI** | `ui-smoke` step 1: sidebar IA (For you / Admin). `e2e-admin-gate` (3): `/admin/*` layout redirects signed-out → `/login?next=`, candidate → `/`, admin renders; admin APIs 401/403/200 by session role. | ✅ 3/3 · UI ✅ |
| 5 | **Single-command startup supervisor** | `launcher.test.ts` (18): .env provisioning, 10 planner fixtures (native/docker/lite/refusals/fallbacks), compose args, backoff, state; `supervisor.test.ts` (1, real processes): restart with backoff, health probe, graceful stop, logs; `steps.test.ts` (2): Ollama pull stream, .env merge. `./jobradar doctor` + `up --dry-run` executed here. | ✅ 21/21 (end-to-end `up` needs a box with pnpm/Docker) |
| 6 | **Free-tier AI model** | `providers.test.ts` (14): Cerebras/Gemini/Groq adapters, quotas, 429/401 handling, chain policy/fallthrough/cooldown, env wiring, embeddings. `e2e-ai-chain` (7): the real analysis → suggestions → variants → answers/cover flow on the chain, Cerebras 429 → Gemini fail-over, PII never leaves, Gemini embeddings + fit, `/api/health` chain. Overview shows the chain (screenshot 14). | ✅ 14/14 + 7/7 · UI ✅ |
| 7 | **E2E flows** | `e2e-sandbox` (16): boards → gateway → enrich → alerts → dashboard → closure → circuits → digest → discovery → liveness → tiering → retention; plus suites 2–6 above; `ui-smoke` (19 steps, 21 screenshots). | ✅ 16/16 + 19/19 |
| 8 | **Regression + unit** | 215 unit/regression tests across packages, apps and tools (incl. OpenAPI drift, erasure, rate limits, vector index, FTS, budgets, PII masking). Migrations: 8 SQL files on real Postgres → 30 tables, 15 enums. Offline typecheck OK. | ✅ 215/215 · migrations PASS |

**Totals: 215 unit · 41 E2E (16+5+6+4+7+3) · 11 extension-in-browser · 19 UI steps — 286 checks, 0 failures.**

## Per-stage output (`tools/sandbox-e2e/run-all.sh`)

    == 1/10 migration check (real Postgres) ==
      PASS — 30 tables, 15 enums → reports/migration-check.md
    == 2/10 unit + regression tests ==
    unit-tests: 215 passed, 0 failed, 0 skipped → reports/unit-tests.md
    == 3/10 end-to-end (simulated infra) ==
    e2e-sandbox: 16 passed, 0 failed, 0 skipped → reports/e2e-sandbox.md
    == 4/10 end-to-end: dynamic preferences (separate process — own in-memory DB) ==
    e2e-prefs: 5 passed, 0 failed, 0 skipped → reports/e2e-prefs.md
    == 5/10 end-to-end: browser-extension API contract ==
    e2e-extension-api: 6 passed, 0 failed, 0 skipped → reports/e2e-extension-api.md
    == 7/10 end-to-end: visual resume editor (save → render → re-score, separate process) ==
    e2e-editor: 4 passed, 0 failed, 0 skipped → reports/e2e-editor.md
    == 8/10 end-to-end: hosted free-tier AI chain in the real flow (cerebras → gemini fixtures, fail-over, PII, embeddings) ==
    e2e-ai-chain: 7 passed, 0 failed, 0 skipped → reports/e2e-ai-chain.md
    == 9/10 end-to-end: User vs Admin separation enforced server-side (layout gate + admin APIs) ==
    e2e-admin-gate: 3 passed, 0 failed, 0 skipped → reports/e2e-admin-gate.md
    == 6/10 browser E2E: real extension in headless Chromium (Playwright) ==
    extension-e2e: 11/11 → reports/extension-e2e.md
    == 10/10 UI smoke: real pages + real API routes + real Tailwind in headless Chromium (HLD-ui-v8 §6) ==
    ui-smoke: 19/19 passed → reports/ui-smoke.md
    ALL GREEN

Reports: `reports/unit-tests.md`, `reports/e2e-*.md`, `reports/extension-e2e.md`, `reports/ui-smoke.md` (+ `reports/ui-smoke/*.png`),
`reports/migration-check.md`, `reports/e2e-artifacts.md` (dashboard rows, Telegram messages, digest, health JSON).

## Not verifiable in this sandbox (run online / on the laptop)

- `pnpm install` → `pnpm -r typecheck` → `next build` (production Tailwind purge, server components, middleware).
- `./jobradar up --ai fast` end-to-end with real keys (one request per provider: `./jobradar ai test`), then
  `pnpm verify:local` (HTTP apply flow against the running app).
- Current free-tier limits vs `packages/llm/src/presets.ts` (they change; overridable with `LLM_<ID>_RPM/RPD/TPM`).

## Verify locally

```bash
# A. offline suite (what produced this report) — needs Node 22, tsx, Playwright Chromium, optional Postgres
export PGHOST=localhost PGUSER=jobradar            # optional: enables the migration check
tools/sandbox-e2e/run-all.sh                       # 10 stages → ALL GREEN, reports/ refreshed

# single suites
tsx tools/testkit/run-tests.ts e2e-ai-chain  tools/sandbox-e2e/ai-chain.test.ts
tsx tools/testkit/run-tests.ts e2e-admin-gate tools/sandbox-e2e/admin-gate.test.ts
tsx tools/testkit/run-tests.ts launcher tools/launcher/launcher.test.ts tools/launcher/supervisor.test.ts tools/launcher/steps.test.ts
node tools/ui-smoke/run.mjs                        # real pages + real API + real Tailwind in Chromium → reports/ui-smoke/
node tools/extension-e2e/run.mjs                   # real extension in Chromium
tools/typecheck-offline/run.sh

# B. the real thing on the laptop
./jobradar doctor                                  # prerequisites + the plan it would run
./jobradar up --ai fast                            # keys: cloud.cerebras.ai, aistudio.google.com → prints URL + admin password
./jobradar ai test                                 # one status request per configured provider
pnpm verify:local                                  # migrations → vitest → next build → HTTP apply flow → reports/verify-summary.md
./jobradar status · ./jobradar logs worker · ./jobradar down
```
