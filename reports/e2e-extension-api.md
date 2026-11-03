# e2e-extension-api

Generated 2026-11-02T08:51:13.208Z · 6 tests · **6 passed** · 0 failed · 0 skipped · 334 ms


## tools/sandbox-e2e/extension-api.test.ts

- ✅ E2E · browser-extension API › 1. pairing needs a session (cookie); the token is returned once and listed/revocable (35 ms)
- ✅ E2E · browser-extension API › 2. /api/ext/* is bearer-only with CORS for extension origins; preflight is 204 (5 ms)
- ✅ E2E · browser-extension API › 3. kit resolves the job from the page URL: exact URL, ATS job id, and profile-only when unknown (9 ms)
- ✅ E2E · browser-extension API › 4. the signed file link is downloadable with the bearer token (no cookie) (4 ms)
- ✅ E2E · browser-extension API › 5. mark applied records submittedVia=extension with the artifacts used, and the kit reflects it (4 ms)
- ✅ E2E · browser-extension API › 6. revoking the token locks the extension out (1 ms)
