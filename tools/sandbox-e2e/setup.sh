#!/usr/bin/env bash
# Links workspace packages + sandbox shims into node_modules so the pipeline can run WITHOUT
# network / Redis / Prisma engines. Never use this in a real environment — run `pnpm install`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NM="$ROOT/node_modules"
mkdir -p "$NM/@jobradar"
for p in crawler extractor ranking notifications watchlist llm resume storage log prefs; do ln -sfn "$ROOT/packages/$p" "$NM/@jobradar/$p"; done
ln -sfn "$ROOT/tools/testkit/shims/db" "$NM/@jobradar/db"
for s in next-server vitest cheerio fast-xml-parser p-queue nodemailer ioredis bullmq zod zod-to-json-schema unpdf mammoth aws-client-s3 aws-presigner; do
  name=$(node -e "console.log(require('$ROOT/tools/testkit/shims/$s/package.json').name)")
  mkdir -p "$(dirname "$NM/$name")"
  ln -sfn "$ROOT/tools/testkit/shims/$s" "$NM/$name"
done
# playwright / docx / pdfjs-dist are available globally in this sandbox
for g in playwright docx pdfjs-dist react react-dom; do [ -e "$NM/$g" ] || ln -sfn "$(npm root -g)/$g" "$NM/$g" 2>/dev/null || true; done
echo "sandbox node_modules linked at $NM"
ls -la "$NM" "$NM/@jobradar" | grep -- '->' | awk '{print "  " $9 " -> " $11}'
