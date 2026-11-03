#!/usr/bin/env bash
# One-command local verification:
#   migrations → unit + integration tests → build web → start web (QUEUE_MODE=inline, no Redis needed)
#   → HTTP end-to-end apply flow → reports/ (unit-tests.md, e2e-apply-flow.md, verify-summary.md)
# Needs: Postgres reachable via DATABASE_URL. Optional: a running Ollama (LLM_PROVIDER=ollama) — without it set
# LLM_PROVIDER=none EMBEDDING_PROVIDER=none and the deterministic paths are exercised.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export PORT="${PORT:-3999}"
export BASE_URL="http://localhost:$PORT"
export QUEUE_MODE=inline
export STORAGE_DRIVER="${STORAGE_DRIVER:-local}"
export STORAGE_LOCAL_ROOT="${STORAGE_LOCAL_ROOT:-./data/verify-objects}"
export STORAGE_SIGNING_SECRET="${STORAGE_SIGNING_SECRET:-verify-signing-secret-0123456789}"
export ADMIN_EMAIL="${ADMIN_EMAIL:-verify@jobradar.local}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-verify-password-123}"
export LLM_PROVIDER="${LLM_PROVIDER:-none}"
export EMBEDDING_PROVIDER="${EMBEDDING_PROVIDER:-fake}"   # fake = deterministic vectors, so erasure of embeddings is exercised (audit NEW-01)
mkdir -p reports
: "${DATABASE_URL:?set DATABASE_URL, e.g. postgresql://jobradar:jobradar@localhost:5432/jobradar}"

echo "== 1/4 migrations =="
if [ "${SKIP_MIGRATE:-0}" = 1 ]; then echo "  skipped (SKIP_MIGRATE=1)"; else
pnpm -s db:migrate:deploy >reports/verify-migrate.log 2>&1 && echo "  ok" || { echo "  FAILED (reports/verify-migrate.log)"; exit 1; }; fi

echo "== 2/4 unit + integration tests =="
node_modules/.bin/vitest run --reporter=default --reporter=json --outputFile=reports/vitest-unit.json >reports/verify-unit.log 2>&1
u=$?
node -e '
const r=require("./reports/vitest-unit.json");
const files=r.testResults||[];const rows=[];let pass=0,fail=0;
for(const f of files){for(const t of f.assertionResults){(t.status==="passed"?pass++:fail++);rows.push(`| ${f.name.replace(process.cwd()+"/","")} | ${t.fullName.replace(/\|/g,"\\|")} | ${t.status==="passed"?"✓":"✗"} | ${t.duration??0} |`)}}
const md=["# Unit + integration tests","",`Generated ${new Date().toISOString()}`,"",`**${fail===0?"PASS":"FAIL"} — ${pass} passed, ${fail} failed, ${files.length} files**`,"","| File | Test | Result | ms |","|---|---|---|---|",...rows,""].join("\n");
require("fs").writeFileSync("reports/unit-tests.md",md);console.log(`  ${pass} passed, ${fail} failed → reports/unit-tests.md`)'

echo "== 3/4 build web =="
(cd apps/web && node_modules/.bin/next build >../../reports/verify-build.log 2>&1) && echo "  ok" || { echo "  FAILED (reports/verify-build.log)"; exit 1; }

echo "== 4/4 end-to-end apply flow (QUEUE_MODE=inline on :$PORT) =="
(cd apps/web && node_modules/.bin/next start -p "$PORT" >../../reports/verify-web.log 2>&1) &
WEB=$!
trap 'kill $WEB 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -sf -o /dev/null "$BASE_URL/login" && break; sleep 1; done
node_modules/.bin/tsx tools/e2e/apply-flow.ts
e=$?
kill $WEB 2>/dev/null; wait $WEB 2>/dev/null

{
  echo "# Verification summary"; echo; echo "Generated $(date -u +%FT%TZ)"; echo
  echo "| Stage | Result |"; echo "|---|---|"
  echo "| Migrations | PASS |"
  echo "| Unit + integration tests | $([ $u = 0 ] && echo PASS || echo FAIL) (reports/unit-tests.md) |"
  echo "| Web build | PASS |"
  echo "| E2E apply flow | $([ $e = 0 ] && echo PASS || echo FAIL) (reports/e2e-apply-flow.md) |"
  echo; echo "LLM_PROVIDER=$LLM_PROVIDER · EMBEDDING_PROVIDER=$EMBEDDING_PROVIDER · QUEUE_MODE=inline"
} > reports/verify-summary.md
echo; cat reports/verify-summary.md
[ $u = 0 ] && [ $e = 0 ] && echo "ALL GREEN" || { echo "FAILURES"; exit 1; }
