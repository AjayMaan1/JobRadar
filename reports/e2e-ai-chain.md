# e2e-ai-chain

Generated 2026-11-02T08:51:18.257Z · 7 tests · **7 passed** · 0 failed · 0 skipped · 762 ms


## tools/sandbox-e2e/ai-chain.test.ts

- ✅ E2E · hosted free-tier chain (cerebras → gemini → deterministic) in the real flow › 1. analysis: requirements come from Cerebras with a JSON-schema request and a bearer key; the report is scored with them (144 ms)
- ✅ E2E · hosted free-tier chain (cerebras → gemini → deterministic) in the real flow › 2. suggestions: the proposal from Cerebras is grounded and stored as a pending suggestion (56 ms)
- ✅ E2E · hosted free-tier chain (cerebras → gemini → deterministic) in the real flow › 3. fail-over: Cerebras returns 429 → the chain serves headline variants from Gemini without the user noticing (56 ms)
- ✅ E2E · hosted free-tier chain (cerebras → gemini → deterministic) in the real flow › 4. while Cerebras is cooling down, answers + cover note go straight to Gemini and land in the Apply Kit (108 ms)
- ✅ E2E · hosted free-tier chain (cerebras → gemini → deterministic) in the real flow › 5. privacy floor holds even with privacy "not a concern": contact details never reach a hosted provider (1 ms)
- ✅ E2E · hosted free-tier chain (cerebras → gemini → deterministic) in the real flow › 6. embeddings via Gemini: job chunks embedded with text-embedding-004 (768 dims), fit computed for the user (56 ms)
- ✅ E2E · hosted free-tier chain (cerebras → gemini → deterministic) in the real flow › 7. /api/health describes the chain: both hosted, PII-allowed by the operator, quota used today on Cerebras and Gemini (6 ms)
