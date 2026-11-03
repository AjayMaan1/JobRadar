#!/usr/bin/env bash
# Offline typecheck (no pnpm install needed): real generated Prisma types + loose ambient types for third-party
# modules. Known baseline noise from the ambient shims is listed in KNOWN; anything else is a real error.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
tools/sandbox-e2e/setup.sh >/dev/null
[ -e node_modules/@types/node ] || { mkdir -p node_modules/@types; for c in docx ts-node; do d="$(npm root -g)/$c/node_modules/@types/node"; [ -d "$d" ] && ln -sfn "$d" node_modules/@types/node && break; done; }
tsc -p tools/typecheck-offline/tsconfig.json > /tmp/jr-tsc.log 2>&1
KNOWN='health/page\.tsx\(6[0-9]|profile/route\.ts\(3[0-9],21|docx\.ts\(18,19|suggest/llm\.ts\(60,16|jd/llm\.ts\(69,5'
# Fields/models added by migrations after the committed Prisma client was generated (run `pnpm db:generate` online):
PENDING_GEN="'(authToken|alertChannel|authTokens|alertChannels|descriptionManual|descriptionManualBy|descriptionManualAt|emailVerifiedAt|searchTsv|AuthToken|AlertChannel|experienceMin|jobUserEval|userPreferences|preferencePreset|preferenceHistory|jobFacts|facts|evals|salaryUsdMin|salaryUsdMax|JobUserEval|UserPreferences|PreferencePreset|PreferenceHistory|JobFacts)'|cover_letter|suggestion\.service\.ts\([0-9]+,7\).*SuggestionKindValue|embeddings?\.(updateMany|findMany|upsert).*updatedAt|ownerType_updatedAt|'updatedAt' does not exist in type 'EmbeddingWhereInput|EmbeddingOrderByWithRelationInput|EmbeddingUpdateInput|EmbeddingUncheckedUpdateInput|'updatedAt' does not exist in type 'Embedding|embedding\\.service\\.ts\\(.*'updatedAt'"
REAL=$(grep "error TS" /tmp/jr-tsc.log | grep -Ev "$KNOWN" | grep -Ev "$PENDING_GEN" || true)
PENDING=$(grep "error TS" /tmp/jr-tsc.log | grep -E "$PENDING_GEN" | wc -l)
TOTAL=$(grep -c "error TS" /tmp/jr-tsc.log || true)
if [ -n "$REAL" ]; then echo "$REAL"; echo; echo "typecheck-offline: FAIL ($(echo "$REAL" | wc -l) real, $PENDING waiting on prisma generate, $TOTAL total)"; exit 1; fi
echo "typecheck-offline: OK ($TOTAL total: $PENDING waiting on prisma generate, rest known shim noise)"
