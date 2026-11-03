#!/usr/bin/env bash
# Runs the full sandbox verification: migration on real Postgres (if available), unit tests, E2E, UI smoke.
# Usage: tools/sandbox-e2e/run-all.sh        (reports land in ./reports)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
mkdir -p reports
tools/sandbox-e2e/setup.sh >/dev/null

echo "== 1/10 migration check (real Postgres) =="
if command -v psql >/dev/null && [ -n "${PGHOST:-}" ]; then
  DB="jobradar_migration_check"
  psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null 2>&1
  ok=1
  for m in packages/db/prisma/migrations/*/migration.sql; do
    if ! psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$m" >"reports/migration-$(basename "$(dirname "$m")").log" 2>&1; then ok=0; echo "  FAILED: $m"; fi
  done
  tables=$(psql -At -d "$DB" -c "select count(*) from information_schema.tables where table_schema='public'")
  enums=$(psql -At -d "$DB" -c "select count(*) from pg_type where typtype='e'")
  { echo "# migration-check"; echo; echo "Generated $(date -u +%FT%TZ)"; echo; echo "- result: $([ $ok = 1 ] && echo PASS || echo FAIL)"; echo "- tables: $tables"; echo "- enum types: $enums"; echo "- migrations:"; for m in packages/db/prisma/migrations/*/migration.sql; do echo "  - $(basename "$(dirname "$m")")"; done; } > reports/migration-check.md
  echo "  $([ $ok = 1 ] && echo PASS || echo FAIL) — $tables tables, $enums enums → reports/migration-check.md"
else
  echo "  skipped (set PGHOST/PGUSER to a running Postgres to enable)"
fi

echo "== 2/10 unit + regression tests =="
# every package/app unit test (integration tests need a real Postgres + pnpm install; the boot test needs vitest's vi.mock)
tsx tools/testkit/run-tests.ts unit-tests $(find packages apps tools/launcher -name '*.test.ts' -not -path '*/node_modules/*' -not -name 'services.integration.test.ts' -not -name 'boot.test.ts' | sort) 2>&1 | grep -v "ExperimentalWarning\|CONTACT_URL\|^\[gateway\]\|^Telegram not\|standardFontDataUrl" | tail -3
u=${PIPESTATUS[0]}

echo "== 3/10 end-to-end (simulated infra) =="
tsx tools/testkit/run-tests.ts e2e-sandbox tools/sandbox-e2e/e2e.test.ts 2>&1 | grep -v "ExperimentalWarning\|CONTACT_URL\|^\[gateway\]\|^\[poll\]" | tail -3
e=${PIPESTATUS[0]}

echo "== 4/10 end-to-end: dynamic preferences (separate process — own in-memory DB) =="
tsx tools/testkit/run-tests.ts e2e-prefs tools/sandbox-e2e/prefs.test.ts 2>&1 | grep -v "ExperimentalWarning\|CONTACT_URL\|^\[gateway\]\|INFO\|WARN" | tail -2
p=${PIPESTATUS[0]}

echo "== 5/10 end-to-end: browser-extension API contract =="
tsx tools/testkit/run-tests.ts e2e-extension-api tools/sandbox-e2e/extension-api.test.ts 2>&1 | grep -v "ExperimentalWarning\|INFO\|WARN" | tail -2
x=${PIPESTATUS[0]}

echo "== 7/10 end-to-end: visual resume editor (save → render → re-score, separate process) =="
tsx tools/testkit/run-tests.ts e2e-editor tools/sandbox-e2e/editor.test.ts 2>&1 | grep -v "ExperimentalWarning\|INFO\|WARN\|standardFont" | tail -2
v=${PIPESTATUS[0]}

echo "== 8/10 end-to-end: hosted free-tier AI chain in the real flow (cerebras → gemini fixtures, fail-over, PII, embeddings) =="
tsx tools/testkit/run-tests.ts e2e-ai-chain tools/sandbox-e2e/ai-chain.test.ts 2>&1 | grep -v "ExperimentalWarning\|INFO\|WARN\|standardFont" | tail -2
a=${PIPESTATUS[0]}

echo "== 9/10 end-to-end: User vs Admin separation enforced server-side (layout gate + admin APIs) =="
tsx tools/testkit/run-tests.ts e2e-admin-gate tools/sandbox-e2e/admin-gate.test.ts 2>&1 | grep -v "ExperimentalWarning\|INFO\|WARN" | tail -2
g=${PIPESTATUS[0]}

echo "== 6/10 browser E2E: real extension in headless Chromium (Playwright) =="
if node -e "require('playwright')" 2>/dev/null; then node tools/extension-e2e/run.mjs 2>&1 | tail -2; b=${PIPESTATUS[0]}; else echo "  skipped (playwright not available)"; b=0; fi

echo "== 10/10 UI smoke: real pages + real API routes + real Tailwind in headless Chromium (HLD-ui-v8 §6) =="
if node -e "require('playwright')" 2>/dev/null; then node tools/ui-smoke/run.mjs 2>&1 | grep -v "ExperimentalWarning" | tail -2; s=${PIPESTATUS[0]}; else echo "  skipped (playwright not available)"; s=0; fi

echo
echo "reports: $(ls reports | tr '\n' ' ')"
[ "$u" = 0 ] && [ "$e" = 0 ] && [ "$p" = 0 ] && [ "$x" = 0 ] && [ "$b" = 0 ] && [ "$v" = 0 ] && [ "$s" = 0 ] && [ "$a" = 0 ] && [ "$g" = 0 ] && echo "ALL GREEN" || { echo "FAILURES (see reports/)"; exit 1; }
