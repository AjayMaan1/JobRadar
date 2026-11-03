# JobRadar v9 — one entry point + AI provider strategy (implementation notes)

Implements `docs/HLD-unified-launcher.md` and the decision in `docs/AI-PROVIDERS.md`.

## A. `./jobradar` launcher (`tools/launcher/`, zero dependencies, Node ≥ 22)

| File | Role |
|---|---|
| `cli.mjs` | commands `up · down · status · doctor · logs · ai setup/test · systemd`; first-run prompts (admin e-mail, AI choice, key); prints the plan before executing; supervises until SIGINT/SIGTERM |
| `detect.mjs` | **Doctor**: versions, TCP reachability of Postgres/Redis/Ollama from `.env`, Ollama models, `node_modules`/Prisma client/Next build freshness, Chromium, free ports, CPU/RAM, missing `.env` keys |
| `plan.mjs` | **pure planner**: facts + flags → mode (`auto→native|docker|lite`), ordered idempotent steps with a *why*, warnings, `envUpdates` (persisted) vs `runtimeEnv` (this run only), or a refusal with the way out |
| `steps.mjs` | executors: `.env` create/merge, `docker compose up -d [services]`, TCP wait, `pnpm install/db:generate/migrate/seed/build`, managed `ollama serve`, model pull over `/api/pull` with progress, `playwright install chromium`, child specs for web/worker |
| `supervisor.mjs` | prefixed multiplexed logs (+ `.jobradar/logs/*.log`), health probes every 15 s (3 failures → restart), exponential backoff 1→30 s, crash budget 10/10 min, graceful drain, `.jobradar/state.json` |
| `env.mjs` | `.env` parse/merge preserving comments, first-run provisioning (`STORAGE_SIGNING_SECRET`, one-time `ADMIN_PASSWORD`, `CONTACT_EMAIL`, `APP_URL`), `aiEnv(choice)` blocks |
| `../../jobradar` | bash shim (Node ≥ 22 check) · `pnpm start|up|down|doctor|ai:setup|ai:test` aliases |

Decision table (tested in `launcher.test.ts`): fresh laptop with Docker → native + compose data services + full
bootstrap · warm server → migrate/seed/app only · no Postgres & no Docker → refusal · Docker without pnpm →
docker mode with `--profile ai` + host-side model pull · `--mode lite` → web only inline · Redis down → inline
for this run · Ollama missing → AI off for this run (or hosted chain with `--ai`) · `--prod` builds when stale and
refuses a busy port; dev moves to 3001.

`docker-compose.yml`: `web`/`worker`/`backup` are default services now (`docker compose up -d` is complete);
`ollama` gained a healthcheck and `ollama-init` pulls `LLM_MODEL` + `EMBEDDING_MODEL` once (profile `ai`);
worker metrics port published on localhost for the health wait.

## B. AI providers (`packages/llm`)

| Piece | What |
|---|---|
| `presets.ts` | `PRESETS` for gemini · groq · cerebras · mistral · openrouter · openai: base URL, default model, embedding model, key env, structured-output mode, free-tier RPM/RPD/TPM, **data-use class** (`local` / `no-train` / `may-train`), paid pricing; `PII_PURPOSES` = parse_resume, suggest, headline, answers |
| `openai-compat.ts` | `OpenAICompatProvider` (`/chat/completions`; `response_format: json_schema` or `json_object` + schema in prompt; 429/`Retry-After` handling; 401/403 disables; TPM-aware prompt trimming; `status()` via `/models`), `QuotaLimiter` (client-side RPM/RPD), `compatFromEnv(id)` with `LLM_<ID>_MODEL/RPM/RPD/TPM/BASE_URL/PAID` overrides |
| `chain.ts` | `ChainProvider`: ordered fallback; skips members the data-use policy forbids for the purpose, members cooling down after http/timeout failures (60 s), members out of quota; schema/parse errors do not fall through |
| `embeddings.ts` | `OpenAICompatEmbeddingProvider` (`EMBEDDING_PROVIDER=gemini|openai|mistral`) |
| `index.ts` | `LLM_PROVIDER` accepts a comma-separated chain; `LLM_PII_PROVIDERS` / `LLM_ALLOW_TRAINING_PROVIDERS_FOR_PII`; a lone may-train provider is still wrapped so the policy applies; `describeLlm()` for health |
| health / UI | `GET /api/health` → `v3.ai` (per provider: kind, model, data-use, PII-eligible, reachable, quota today, cooldown) + alerts; Admin → Overview: AI tile shows the active provider and a new **AI providers** card with the chain; worker logs one line per provider at boot |
| `.env.example` | new AI block with the chain examples and all key names |

**Shipped default is now the free-tier chain** (`.env.example`: `LLM_PROVIDER=cerebras,gemini,groq,none`,
`LLM_PII_PROVIDERS=cerebras,gemini,groq`, `EMBEDDING_PROVIDER=gemini`; launcher first-run default `fast`). Chain
members whose key is empty are skipped with a warning (a lone misconfigured provider still fails loudly), and an
embedding provider without its key degrades to keyword matching — so a fresh checkout boots before any key exists.
Budgets, PII masking, grounding and the response cache wrap the chain exactly as they wrapped the single provider.
`--ai local` restores the all-Ollama setup; `--ai hybrid` = no-training tiers + local fallback.

## Verification

| Check | Result |
|---|---|
| `tools/launcher/launcher.test.ts` (18) | .env parse/merge/provision, 10 planner fixtures, compose args, child specs, backoff, state file |
| `tools/launcher/supervisor.test.ts` (1, real processes) | healthy HTTP child + crash-looping child: restarts with backoff, logs captured per child, graceful SIGTERM stop, state cleared |
| `tools/launcher/steps.test.ts` (2) | Ollama pull over NDJSON (skip present, progress, error line), `.env` creation/merge idempotency |
| `tools/sandbox-e2e/ai-chain.test.ts` (7, real routes + inline runner + real chain, hosted endpoints as fixtures) | analysis → Cerebras json_schema request → scored report; suggestions grounded; Cerebras 429 → Gemini serves variants; answers + cover via Gemini into the Apply Kit; no e-mail/phone reaches any hosted provider; Gemini embeddings (768 d) + fit; `/api/health` chain with quota |
| `tools/sandbox-e2e/admin-gate.test.ts` (3) | `/admin/*` layout: signed-out → `/login?next=`, candidate → `/`, admin renders; admin APIs 401/403/200 by session role |
| `packages/llm/src/providers.test.ts` (14) | quota windows, gemini/groq request shapes, 429→budget, 401→disabled, client-side quota, schema errors, `/models` status, chain policy/fallthrough/cooldown, env wiring, `describeLlm`, compat embeddings |
| `./jobradar doctor` / `./jobradar up --dry-run --yes --ai gemini` in this sandbox | correct refusal without Postgres/Docker; with a local Postgres: native plan with inline fallback and Ollama-missing fallback printed |
| `tools/typecheck-offline/run.sh` | OK |
| `tools/sandbox-e2e/run-all.sh` (8 stages, launcher tests included in stage 2) | ALL GREEN — migrations 30 tables/15 enums · unit 215/215 · e2e-sandbox 16 · prefs 5 · extension-API 6 · extension browser 11/11 · editor 4 · ui-smoke 19/19 (Overview shows the provider chain) |

### Needs the online CI / a real box
`./jobradar up` end-to-end on a fresh clone with Docker (model pulls, `pnpm install`, `next dev`); `./jobradar up
--prod` + the generated systemd unit on the Mint box; `docker compose --profile ai up -d` alone; one real call per
hosted provider with a key (`./jobradar ai test`), and a check of the current free-tier limits against `PRESETS`.
