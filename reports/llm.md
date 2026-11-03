# llm

Generated 2026-11-02T05:24:03.091Z · 9 tests · **9 passed** · 0 failed · 0 skipped · 3552 ms


## packages/llm/src/llm.test.ts

- ✅ AnthropicProvider › forces tool use with the zod schema and validates the tool input (88 ms)
- ✅ AnthropicProvider › retries on 429/5xx then succeeds; schema-invalid output is a typed error (2228 ms)
- ✅ AnthropicProvider › refuses to start without an API key (1 ms)
- ✅ extractJson › handles fences, leading prose and trailing chatter (8 ms)
- ✅ PII masking › masks emails, phones, urls and names reversibly; leaves years alone (9 ms)
- ✅ PII masking › same value gets the same placeholder (0 ms)
- ✅ budget › meters calls and blocks when the per-user cap is hit (20 ms)
- ✅ untrusted() › wraps and strips nested tag attempts (0 ms)
- ✅ budget without Redis (inline mode, audit NEW-04) + response cache (GH-11) › MemoryBudgetStore enforces per-user caps and the cache short-circuits identical prompts (32 ms)
