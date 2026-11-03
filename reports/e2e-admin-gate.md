# e2e-admin-gate

Generated 2026-11-02T08:51:19.204Z · 3 tests · **3 passed** · 0 failed · 0 skipped · 562 ms


## tools/sandbox-e2e/admin-gate.test.ts

- ✅ E2E · User vs Admin separation is server-side › 1. /admin/* layout: signed-out → /login?next=/admin, candidate → /, admin → renders (45 ms)
- ✅ E2E · User vs Admin separation is server-side › 2. admin APIs (/api/health, /api/admin/queues) are 401/403 for candidates and 200 for admins (12 ms)
- ✅ E2E · User vs Admin separation is server-side › 3. the sidebar decides the Admin group from /api/auth/me role — which is the session role, not a client flag (1 ms)
