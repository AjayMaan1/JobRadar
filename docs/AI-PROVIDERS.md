# AI providers — free tiers vs. running locally

Decision record + operating guide for the "small AI" in JobRadar. Numbers for hosted free tiers are taken from
the providers' public rate-limit pages as of this writing; **they change monthly — re-check the linked pages
before relying on them**. Nothing in the product *requires* an LLM: every AI call has a deterministic fallback
(`LLM_PROVIDER=none` is a supported configuration, exercised by the offline test suite).

## 1. What we actually ask a model to do

| Purpose (`LlmPurpose`) | When | Input → output (approx. tokens) | Sensitive? | Deterministic fallback |
|---|---|---|---|---|
| `parse_resume` | once per uploaded resume | 2–10k → 2–6k (JSON Resume) | **yes** — the resume (PII masked: e-mails, phones, URLs, name → placeholders) | heading/date/bullet heuristic parser + review screen |
| `analyze_jd` | once per job the user analyses (cached by JD hash) | 1–4k → 0.5–1.5k | no — public posting | keyword/skill extractor (`analyzeJdDeterministic`) |
| `suggest` (×2) | per "Analyse & suggest" | 3–6k → 1–4k | **yes** — resume + JD | skills-gap list without rewrites |
| `headline` | on request | 1–2k → ≤1.2k | **yes** — profile text | none (feature hidden) |
| `answers` | per apply kit | 2–4k → ≤2.5k | **yes** — resume, profile, confirmed facts | templated answers from apply defaults |
| `answers` (cover) | on request | 2–3k → ≤0.9k | **yes** | assembled cover note (no prose generation) |
| `extract_job` | only when a crawled posting lacks title/company/URL (rare) | 1k → 0.5k | no | skip the posting |
| **embeddings** | every new job (3 chunks), resumes, queries | 24k texts for a 8k-job corpus once, then ~300 texts / 15 min | partly (resume chunks) | keyword search / quick-match only |

Volume model (what a free tier must absorb): a heavy user analyses ~10 jobs/day → ~60 LLM calls/day, ~250k
input tokens/day. A five-user box ≈ 300 calls/day. Resume parsing is negligible. **Embeddings are the only
high-volume call** and they are cheap to run locally (nomic-embed-text: ~100 texts/s on two CPU cores).

Every call already goes through: PII masking (`packages/llm/src/pii.ts`), schema-constrained JSON output,
the grounding validator (nothing invented reaches the user unflagged), a daily call/USD budget per user and
globally (`LLM_*_CAP`), and a 7-day response cache. The provider is a thin adapter behind `LlmProvider`.

## 2. Candidates

### 2.1 Local (current default)

| | Ollama · qwen2.5:3b-instruct + nomic-embed-text |
|---|---|
| Cost | ₹0, offline |
| Privacy | data never leaves the box — the only option that needs no policy review for resumes |
| Quality | adequate for extraction/rewrites because outputs are schema-validated and grounded; noticeably weaker prose than 70B+ hosted models |
| Latency on the 2-core / 16 GB target | parse 3–6 min · analyse + suggest 2–4 min · answers 1–2 min (SETUP-LINUX-MINT §3) |
| Latency with a consumer GPU (8 GB) or Apple Silicon | 5–20 s for the same calls; 7B models become practical |
| Ops | one extra daemon, 2–3 GB RAM resident, model pulls (2.3 GB) |

### 2.2 Hosted free tiers (LLM)

| Provider | Free models (examples) | Free limits (approx.) | Structured output | Data use on the free tier | Fit |
|---|---|---|---|---|---|
| **Google Gemini API** — [ai.google.dev/gemini-api/docs/rate-limits](https://ai.google.dev/gemini-api/docs/rate-limits) | gemini-2.0-flash, 2.0-flash-lite, 2.5-flash(-lite); text-embedding-004 / gemini-embedding-001 | 2.0-flash ≈ 15 RPM · 1M TPM · 1,500 RPD; 2.5-flash ≈ 10 RPM · 250 RPD; flash-lite higher RPD; embeddings ≈ 100–1,500 RPM | JSON schema (`response_format`, OpenAI-compatible endpoint) | **Unpaid tier: prompts/outputs may be used to improve Google products and reviewed by humans** (Gemini API additional terms). Paid tier: not used for training | Best capability per rupee for *public* inputs (JD analysis, job extraction). Not acceptable for resume text under our privacy promise unless the user opts in or pays |
| **Groq** — [console.groq.com/docs/rate-limits](https://console.groq.com/docs/rate-limits) | llama-3.3-70b-versatile, llama-3.1-8b-instant, gemma2, qwen | 70B ≈ 30 RPM · ~1k RPD · ~12k TPM; 8B ≈ 30 RPM · 14.4k RPD | `json_object` (+ schema in prompt; validated locally) | States it does not train on customer data; prompts retained briefly for abuse monitoring | Fast (sub-second), good quality at 70B, **RPD and TPM are the constraints** — a 6k-token suggest call can trip 12k TPM |
| **Cerebras** — [inference-docs.cerebras.ai/support/rate-limits](https://inference-docs.cerebras.ai) | llama-3.3-70b, llama3.1-8b, qwen-3-32b | ≈ 30 RPM · 60k TPM · 1M tokens/day | `json_object` / schema | no training on API data per their terms | Very fast; generous daily tokens; newer models rotate |
| **Mistral** — [docs.mistral.ai](https://docs.mistral.ai/deployment/laplateforme/tier/) "Experiment" plan | mistral-small, open-mistral-nemo, codestral; mistral-embed | ≈ 1 RPS · 500k TPM · 1B tokens/month | JSON mode / schema | **Free tier requires opting in to data use for training** | Generous volume, European jurisdiction; the training opt-in rules out resume text |
| **OpenRouter** free models (`:free`) | rotating: llama, gemma, qwen, deepseek… | ≈ 20 RPM · 50 RPD (1,000 RPD after a one-time $10 credit) | depends on upstream | **Free models route to providers that may log/train; OpenRouter lets you disable such routes, which leaves few free models** | Good for experimentation only |
| **GitHub Models** | gpt-4o-mini, llama, phi, mistral | per-model tiers, roughly 10–15 RPM · 50–150 RPD · 8k in / 4k out tokens | JSON schema (OpenAI API) | governed by GitHub terms; prototyping use | Tiny output caps make `parse_resume` impossible |
| **Cloudflare Workers AI** | llama-3.1-8b, qwen, bge embeddings | 10,000 "neurons"/day ≈ a few hundred 8B calls | `json_schema` on some models | CF states no training on customer inputs | Workable for JD analysis; 8B quality only |
| **Cohere** trial | command-r, embed-v3 | 20 RPM · 1,000 calls/month | JSON schema | trial keys are for evaluation | Too small |
| **Hugging Face Inference** | many | ~$0.10/month of credits on free accounts | varies | varies | Too small |

### 2.3 Hosted paid (for completeness)
Anthropic (already integrated, `LLM_PROVIDER=anthropic`), OpenAI, Gemini paid tier. At our volume
(≈ 300 calls/day ≈ 1.5M input + 0.4M output tokens/day) a "mini/flash" class model costs **₹200–600/month**; a
frontier model ₹3–8k/month. Paid tiers carry no-training terms.

## 3. Assessment

1. **Capacity**: every serious free tier covers a *single user* comfortably (60 calls/day vs 250–1,500 RPD)
   and a small household; none covers a multi-tenant deployment. Per-minute limits, not daily ones, bite
   first because "Analyse & suggest" fires 3–4 calls in a burst → the adapter must queue per provider.
2. **Privacy is the real constraint, not quota.** JobRadar promises "your resume is masked before any AI
   processing" and self-hosting. PII masking hides contact details, but the *content* of a resume (employers,
   dates, projects) is personal data. Gemini's unpaid tier and Mistral's free plan explicitly use inputs for
   training → they may only see **public inputs**: job descriptions (`analyze_jd`, `extract_job`). Groq,
   Cerebras and Cloudflare state no-training policies and are acceptable for resume-derived prompts **with the
   user's knowledge**.
3. **Latency**: on the 2-core target, hosted Flash/70B models turn 3-minute waits into 5–10 s. On a GPU box
   or Apple Silicon the local model is already fast enough and the argument for cloud disappears.
4. **Reliability**: free tiers return 429 often and change without notice. A provider **chain** with local
   fallback keeps the product working; the deterministic path remains the floor.
5. **Embeddings**: keep local. Corpus-wide re-embedding (tens of thousands of texts) is exactly what free
   tiers throttle, and switching models forces a full re-embed (vectors are keyed by model; old rows are
   ignored, not migrated). A cloud embedding model is supported for boxes that cannot run Ollama at all.

## 4. Decision

**Shipped default (this deployment): the hosted free-tier chain** — `LLM_PROVIDER=cerebras,gemini,groq,none`,
`LLM_PII_PROVIDERS=cerebras,gemini,groq`, `EMBEDDING_PROVIDER=gemini` (`./jobradar up --ai fast`). The target
machine is a 2-core i7‑5th‑gen laptop where the local 3B model needs 3–6 minutes per action; the owner has
chosen speed over the Gemini free-tier training caveat (contact details are still masked on every call). Local
Ollama remains a first-class option (`--ai local`) and is the right default on a GPU / Apple Silicon box or
wherever privacy outranks speed.

**Hosted tiers are a chain with a deterministic floor, never a hard dependency**, implemented as:

- One generic **OpenAI-compatible provider** (`packages/llm/src/openai-compat.ts`) with presets for
  `gemini`, `groq`, `cerebras`, `mistral`, `openrouter`, `openai` (base URL, default model, free-tier RPM/RPD,
  data-use class). Structured output via `response_format: json_schema` where supported, `json_object` +
  local schema validation elsewhere; `429`/`Retry-After` honoured; per-provider token-bucket (RPM) and daily
  (RPD) limiters sized to the free tier so we never burn the quota on retries.
- A **chain**: `LLM_PROVIDER=groq,ollama` tries providers in order; a provider is skipped when its quota is
  exhausted, it is unreachable, or the **data-use policy** forbids the purpose. Policy:
  `LLM_PII_PROVIDERS` (default: every `local` or `no-train` provider) lists who may receive resume-derived
  purposes (`parse_resume`, `suggest`, `headline`, `answers`); providers classed `may-train` (Gemini free,
  Mistral free, OpenRouter free) only ever receive `analyze_jd` / `extract_job` unless the operator sets
  `LLM_ALLOW_TRAINING_PROVIDERS_FOR_PII=1` consciously.
- **Embeddings** gain the same compat adapter (`EMBEDDING_PROVIDER=gemini|openai|mistral`) for boxes without
  Ollama; switching is a full re-embed and is documented as such.
- `/api/health` + Admin → Overview show the chain: each provider's reachability, model, quota used today, and
  whether it is PII-eligible, instead of the Ollama-only tile.
- `./jobradar up --ai local|gemini|groq|cerebras|mistral|none` writes the corresponding `.env` block and
  validates the key with one request.

### Recommended configurations

| Machine / need | Setting |
|---|---|
| Laptop with GPU or Apple Silicon; privacy first | `LLM_PROVIDER=ollama` (`LLM_MODEL=qwen2.5:7b-instruct`), `EMBEDDING_PROVIDER=ollama` — **best overall** |
| **2-core / 16 GB laptop, speed first, privacy not a concern** | **`./jobradar up --ai fast`** → `LLM_PROVIDER=cerebras,gemini,groq,none`, `LLM_PII_PROVIDERS=cerebras,gemini,groq`, `EMBEDDING_PROVIDER=gemini`. No Ollama at all: Cerebras answers in 2–4 s (60k TPM — full resume parses, native json_schema), Gemini 2.0 Flash is the fallback and does embeddings (768 dims, same as nomic), Groq is used only if its key is present (12k TPM trims resume parses → never first). Deterministic floor when every tier is out |
| **2-core / 16 GB laptop, privacy-conscious** | **`./jobradar up --ai hybrid`** → `LLM_PROVIDER=cerebras,groq,ollama`, `LLM_PII_PROVIDERS=cerebras,groq`, embeddings local. Seconds per call; the local 3B model is only the fallback. Local-only (`qwen2.5:3b-instruct`) works but every AI action takes 3–6 minutes: ~5–7 tok/s generation and ~30 tok/s prompt processing on two Broadwell cores; 7B is impractical (2–3 tok/s) |
| Same box, want seconds instead of minutes, no cloud PII | `LLM_PROVIDER=gemini,ollama` → JD analysis on Gemini free, everything resume-related stays local |
| Same box, accept a no-training cloud for resume text | `LLM_PROVIDER=groq,ollama` + `LLM_PII_PROVIDERS=groq,ollama` (70B quality; beware 12k TPM → `LLM_MAX_PROMPT_CHARS=12000`) |
| No Ollama possible (tiny VPS) | `LLM_PROVIDER=cerebras,groq,none`, `EMBEDDING_PROVIDER=gemini` or `none` |
| Several users, no budget | local only; a free tier's RPD is shared by all users and will be exhausted by noon |
| Budget ₹500/month, many users | `LLM_PROVIDER=gemini` **paid** tier or `anthropic` (no-training terms); local embeddings |

## 5. Operating notes
- Quotas are enforced client-side from the preset (`LLM_<PROVIDER>_RPM/RPD` override) and visible on the
  Overview tile; when a provider shows "quota exhausted" the chain has already moved on — nothing to do.
- Keys live only in `.env` (`GEMINI_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `MISTRAL_API_KEY`,
  `OPENROUTER_API_KEY`, `OPENAI_API_KEY`); `./jobradar ai test` sends one request per configured provider.
- The 7-day response cache makes re-analysis of the same JD free on every provider.
- Re-check the provider pages quarterly; update `PRESETS` in `openai-compat.ts` when limits move.
