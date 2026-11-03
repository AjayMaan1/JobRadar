# JobRadar

Self-hosted job radar: polls company boards and aggregators every few minutes, evaluates every posting against
**your** preferences (tiers, pay floor, home metros), scores it against your resume, proposes grounded
improvements, renders tailored versions, assembles an apply kit and autofills employer forms through a browser
extension. Nothing is changed or sent without you.

## Run it

```bash
./jobradar up          # first run: asks for your e-mail and an AI choice, then brings everything up
```

That is the whole install. The launcher checks prerequisites, writes `.env` with generated secrets, starts
Postgres/Redis (Docker) if nothing is listening, installs dependencies, migrates and seeds the database, starts
and pulls models for local AI (Ollama) when available, then supervises the web app and the worker with health
checks and restarts. Open the printed URL and sign in with the printed password.

```bash
./jobradar doctor      # what is installed / reachable, and what `up` would do
./jobradar status      # what is running
./jobradar logs worker
./jobradar down
./jobradar up --prod               # production build + json logs (also: ./jobradar systemd)
./jobradar up --mode docker        # everything in docker compose, no pnpm needed
./jobradar ai setup                # local Ollama, or a hosted free tier (Gemini / Groq / Cerebras …)
```

Requirements: Node ≥ 22 and pnpm, plus **either** Docker **or** local Postgres 16 + Redis 7. AI uses hosted free
tiers by default (`--ai fast`: two free keys, seconds per action); `--ai local` runs everything on the box with
Ollama instead. Without any of it the app runs deterministic-only.

## Where to read next

| Topic | Doc |
|---|---|
| One entry point — design | `docs/HLD-unified-launcher.md` |
| AI: free tiers vs. local, privacy policy, recommended configs | `docs/AI-PROVIDERS.md` |
| Small-box setup and what to expect (2 cores / 16 GB) | `docs/SETUP-LINUX-MINT.md` |
| Operations (alerts, backups, incidents, accounts, routes) | `docs/RUNBOOK.md` |
| UI map | `docs/HLD-ui-v8.md` |
| Verification (offline suite, full-stack) | `docs/VERIFICATION.md` |
| Architecture and history | `docs/HLD-*.md`, `docs/IMPLEMENTATION-v*.md`, `audit/` |

## Verify

```bash
tools/sandbox-e2e/run-all.sh    # offline: migrations, 220+ unit tests, 5 E2E suites, extension + UI in headless Chromium
./jobradar up && pnpm verify:local   # full stack
```
