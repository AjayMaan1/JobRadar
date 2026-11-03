import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

/**
 * Simulated E2E under real vitest: aliases @jobradar/db and next/server to the in-memory shims so the
 * full pipeline runs without Postgres/Redis/network. `pnpm test:e2e:sandbox`
 */
export default defineConfig({
  test: {
    include: ['tools/sandbox-e2e/**/*.test.ts'],
    reporters: ['default', 'json'],
    outputFile: { json: 'reports/vitest-e2e-sandbox.json' },
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@jobradar/db': resolve(__dirname, 'tools/testkit/shims/db/index.ts'),
      'next/server': resolve(__dirname, 'tools/testkit/shims/next-server/index.ts'),
      'next/headers': resolve(__dirname, 'tools/testkit/shims/next-server/headers.ts'),
      nodemailer: resolve(__dirname, 'tools/testkit/shims/nodemailer/index.ts'),
      ioredis: resolve(__dirname, 'tools/testkit/shims/ioredis/index.ts'),
      bullmq: resolve(__dirname, 'tools/testkit/shims/bullmq/index.ts'),
    },
  },
})
