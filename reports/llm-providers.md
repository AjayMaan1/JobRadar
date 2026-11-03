# llm-providers

Generated 2026-11-02T08:48:37.868Z · 14 tests · **14 passed** · 0 failed · 0 skipped · 356 ms


## packages/llm/src/providers.test.ts

- ✅ QuotaLimiter (client-side free-tier guard) › enforces per-minute and per-day windows and rolls them over (2 ms)
- ✅ OpenAICompatProvider › gemini preset: json_schema response_format, bearer key, cost 0 on the free tier, quota recorded (29 ms)
- ✅ OpenAICompatProvider › groq preset: json_object mode puts the schema in the system prompt, fenced output is parsed, TPM cap trims long prompts (2 ms)
- ✅ OpenAICompatProvider › 429 beyond retries becomes a non-retryable budget error (chain moves on); 401 disables the provider (2 ms)
- ✅ OpenAICompatProvider › client-side quota stops calls before the provider does (0 ms)
- ✅ OpenAICompatProvider › schema-invalid output is a typed schema error; missing key is a config error at construction (1 ms)
- ✅ OpenAICompatProvider › status(): /models reachability and key validity without spending tokens (1 ms)
- ✅ ChainProvider (ordered fallback + data-use policy) › public purposes go to the first provider; resume-derived purposes skip may-train providers (1 ms)
- ✅ ChainProvider (ordered fallback + data-use policy) › operator opt-in (piiAllowed) lets a may-train provider see resume text (0 ms)
- ✅ ChainProvider (ordered fallback + data-use policy) › budget/http/timeout errors fall through; http/timeout put the member in cooldown; schema errors do not fall through (2 ms)
- ✅ ChainProvider (ordered fallback + data-use policy) › when every member is skipped or failing, the error lists each reason (0 ms)
- ✅ createLlmProvider / describeLlm (env wiring) › parses a comma-separated chain, applies LLM_PII_PROVIDERS, and enforces the policy even on a lone may-train provider (3 ms)
- ✅ createLlmProvider / describeLlm (env wiring) › describeLlm reports each member with kind, data-use, PII eligibility and quota (64 ms)
- ✅ OpenAICompatEmbeddingProvider › embeds in order, normalises, and is selected by EMBEDDING_PROVIDER=<preset> (1 ms)
