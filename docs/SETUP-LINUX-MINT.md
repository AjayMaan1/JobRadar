# Running JobRadar on a small Linux box (2 cores · 16 GB · no paid AI)

Tested target: i7 5th-gen, 2 cores / 4 threads @ 2.4 GHz, 16 GB DDR3L, Linux Mint. Everything runs locally; no tokens are bought.

## 1. Install — one command

```bash
git clone … jobradar && cd jobradar
./jobradar up            # asks two questions on the first run (admin e-mail, AI choice — default "fast"), then does everything
```

AI on this laptop: the default **`fast`** profile uses hosted free tiers (Cerebras → Gemini → Groq) — seconds per
action, no Ollama, no model downloads; you need two free keys (cloud.cerebras.ai, aistudio.google.com). Choose
`local` instead if you want everything on the box and accept minutes per action (docs/AI-PROVIDERS.md §4).

What `up` does on this box (docs/HLD-unified-launcher.md): creates `.env` from the example with generated
secrets and a one-time admin password (printed once), starts Postgres + Redis in Docker if nothing is listening,
`pnpm install` / `db:generate` / `migrate deploy` / `db:seed`, writes the AI keys (or, with `--ai local`, starts
`ollama serve` and pulls `qwen2.5:3b-instruct` + `nomic-embed-text`), installs Chromium for PDF rendering,
then supervises **web + worker** with health probes and crash restarts. `Ctrl-C` or `./jobradar down` stops it.

Prerequisites: Node 22, pnpm (`corepack enable && corepack prepare pnpm@9.14.2 --activate`), Docker *or* a local
Postgres 16 + Redis 7, and — for local AI — Ollama (`curl -fsSL https://ollama.com/install.sh | sh`). Check with
`./jobradar doctor`. Without Ollama, `up` continues with AI off and tells you how to pick a hosted free tier
(`./jobradar ai setup`, see docs/AI-PROVIDERS.md).

Useful variants:

```bash
./jobradar up --prod                 # next build + next start, json logs (what the systemd unit runs)
./jobradar up --mode docker          # everything in compose, incl. Ollama + model pulls (no pnpm needed)
./jobradar up --mode lite            # one web process, QUEUE_MODE=inline, no Redis/worker (tiny installs, verification)
./jobradar up --ai gemini            # hosted free tier for job-description analysis; resume text stays local
./jobradar systemd | sudo tee /etc/systemd/system/jobradar.service   # boot persistence: one unit
./jobradar status · ./jobradar logs worker · ./jobradar down
```

Manual equivalent (what the launcher automates):

```bash
docker compose up -d postgres redis
ollama pull qwen2.5:3b-instruct && ollama pull nomic-embed-text
pnpm install && pnpm db:generate && pnpm db:migrate:deploy && pnpm db:seed
npx playwright install chromium
cp .env.example .env   # set ADMIN_*, STORAGE_SIGNING_SECRET
pnpm worker:dev & pnpm web:dev
```

## 2. Memory budget (steady state)

| Process | RSS |
|---|---|
| Postgres + Redis | ~350 MB |
| web (Next.js) | ~250 MB |
| worker (Node) + Chromium when rendering | ~400–700 MB |
| Ollama: qwen2.5:3b Q4 + nomic-embed-text resident | ~3.0 GB |
| **Total** | **≈ 4–5 GB** — leaves >10 GB free; no swap pressure |

## 3. What to expect (2 cores, 2.4 GHz)

| Action | Wait |
|---|---|
| Resume upload → parsed (once) | 3–6 min |
| "Analyse & suggest" (requirements + suggestions) | 2–4 min total; the score itself appears after ~1 min |
| Headline / About variants | ~1 min |
| Drafted answers | 1–2 min |
| Tailored resume render | 5–15 s |
| Semantic search / fit | instant (embeddings precomputed; query embedding ≈ 50 ms) |
| Embedding backfill | ~100 jobs / 15-min run, or ~60 s per 100 when idle |

The LLM lane is serialised (`LLM_CONCURRENCY=1`): a second AI request waits for the first. The UI shows "Queued…" — keep browsing, everything non-AI stays instant.

## 4. Why it won't fall over

- **One LLM request at a time**, prompts capped at 16k chars (`LLM_MAX_PROMPT_CHARS`), 8k context, 15-min timeout → bounded CPU and memory per job.
- Crawl/poll/enrich concurrency lowered (2/4/2) so polling never starves the model or vice-versa.
- Chromium: one page at a time (`RENDER_CONCURRENCY=1`), context closed after every render.
- Vectors are stored in plain Postgres and searched in-process (≈ 46 MB for 5k jobs × 3 chunks); no extra services. Revisit pgvector past ~50k jobs.
- Every AI feature degrades to the deterministic path when Ollama is down (worker logs a WARN; Health shows "Ollama: down"); keyword scoring, hydration, rendering and the apply kit keep working.

## 5. Faster AI without a GPU: hosted free tiers

On this 2-core box every AI call takes minutes. `./jobradar ai setup` → `gemini` sends **job-description analysis**
to Gemini's free tier (seconds) while resume parsing, suggestions and answers stay on the local model; `groq` or
`cerebras` (no-training policies) can also take the resume-derived calls. Quotas are enforced client-side and the
chain falls back to Ollama / deterministic when a tier is exhausted. Full comparison: docs/AI-PROVIDERS.md.

## 6. Tuning knobs

- Faster, dumber: `LLM_MODEL=qwen2.5:1.5b-instruct` (halves waits; parsing quality drops — rely on the review screen).
- Smarter, slower: `LLM_MODEL=qwen2.5:7b-instruct` (≈4.7 GB; 2–3× the waits above; fine overnight for parsing).
- If the laptop throttles: `OLLAMA_NUM_THREAD=2` (physical cores) is already set; avoid 4.
- `FIT_COS_MIN/MAX`, `FIT_EVIDENCE_TAU`: adjust after comparing a few of your own applications against the scores.
