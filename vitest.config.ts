import { defineConfig } from 'vitest/config'

/** Default: unit + regression tests (no infra needed; in-memory doubles from tools/testkit). */
export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tools/sandbox-e2e/**'],
    reporters: ['default', 'json'],
    outputFile: { json: 'reports/vitest-unit.json' },
  },
})
