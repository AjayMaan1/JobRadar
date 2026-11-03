# HLD — One entry point: `./jobradar up`

## 1. Problem

Running JobRadar today means orchestrating six processes and a dozen manual steps, in the right order:

| # | Step today | Where it is written down |
|---|---|---|
| 1 | `docker compose up -d postgres redis` | SETUP-LINUX-MINT §1 |
| 2 | install Ollama, `ollama serve`, set `OLLAMA_*` env, `systemctl restart ollama` | SETUP §1 |
| 3 | `ollama pull qwen2.5:3b-instruct`, `ollama pull nomic-embed-text` | SETUP §1 |
| 4 | `pnpm install`, `pnpm db:generate` | SETUP §1 |
| 5 | `pnpm db:migrate:deploy`, `pnpm db:seed` (host policies, anchors, sources) | SETUP / RUNBOOK |
| 6 | `npx playwright install chromium` | SETUP §1 |
| 7 | `cp .env.example .env`, invent `STORAGE_SIGNING_SECRET`, `ADMIN_EMAIL/PASSWORD`, `CONTACT_*` | SETUP §1, .env.example |
| 8 | `pnpm worker:dev` (terminal 1) | SETUP §1 |
| 9 | `pnpm web:dev` (terminal 2) | SETUP §1 |
| 10 | check `/admin` for "worker alive / Ollama reachable" | RUNBOOK |
| 11 | production: `next build`, systemd units ×2, backup timer | deploy/systemd, RUNBOOK |
| 12 | on every reboot: repeat 1, 2, 8, 9 | — |

Each step has its own failure mode and its own log. Nothing restarts a crashed worker in dev, nothing tells
you that the model was never pulled until the first "Analyse" call fails minutes later.

## 2. Goals / non-goals

**Goals**
- One command brings the whole system to a healthy state from a fresh clone *or* a reboot, on a laptop or a
  server: `./jobradar up` (or `pnpm start`). One command stops it: `./jobradar down`.
- The launcher **decides** what is missing and does it (install deps, migrate, pull models, start infra),
  prints what it decided and why, and refuses with a fix-it message when it cannot (no Docker *and* no local
  Postgres).
- One supervised process tree with prefixed logs, health probes, crash restarts with backoff, clean shutdown.
- First run provisions `.env`: generated secrets, admin credentials (printed once), AI provider choice.
- Works in three shapes: **native** (pnpm + local Postgres/Redis/Ollama), **docker** (everything in compose,
  including model pulls), **lite** (single web process, `QUEUE_MODE=inline`, no Redis/worker — verification and
  tiny installs).
- Zero new dependencies: the launcher is plain Node ≥ 22 ESM (`node:child_process`, `node:net`, `fetch`), so
  it runs *before* `pnpm install`.

**Non-goals**: a GUI installer, Windows service registration, Kubernetes manifests, replacing systemd for
production hosts (the launcher *generates* the unit files instead).

## 3. Architecture

```
 ./jobradar up [--mode auto|native|docker|lite] [--prod] [--ai local|gemini|groq|…|none] [--yes]
        │
        ▼
 ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌───────────────────────────────┐
 │   DOCTOR     │ → │    PLAN      │ → │   EXECUTE    │ → │         SUPERVISE             │
 │ detect facts │   │ pure function│   │ steps, each  │   │ children · health probes ·    │
 │ (no side     │   │ facts+flags  │   │ idempotent & │   │ restart w/ backoff · logs ·   │
 │  effects)    │   │ → steps[]    │   │ logged       │   │ SIGINT/SIGTERM drain · state  │
 └──────────────┘   └──────────────┘   └──────────────┘   └───────────────────────────────┘
   node/pnpm/docker    "what & why"      .env write         .jobradar/state.json (pids,
   pg/redis/ollama     printed before     pnpm install        ports, mode) → status / down
   models, chromium    anything runs      migrate, seed
   RAM/cores, ports                       model pulls
   .env completeness                      build (prod)
```

### 3.1 Doctor (`tools/launcher/detect.mjs`)
Pure observation, runs in < 2 s: versions (`node`, `pnpm`, `docker compose`), TCP reachability of the
Postgres/Redis/Ollama endpoints named in `.env`, Ollama model list (`/api/tags`), `node_modules`, generated
Prisma client, Chromium in Playwright's cache, free ports (3000, 9464), CPU/RAM, and which `.env` keys are
missing or empty. `./jobradar doctor` prints the table and exits.

### 3.2 Plan (`tools/launcher/plan.mjs`)
`plan(facts, flags) → { mode, steps[], warnings[], env }` with **no I/O**, so it is unit-tested against
fact fixtures (fresh laptop with Docker; server with native Postgres; no Docker + nothing local → refusal;
Ollama missing → cloud or deterministic fallback; `--lite`). Mode resolution:

```
--mode given → that mode (fail loudly if impossible)
auto:  native Postgres reachable            → native (Redis: local if reachable, else docker if available, else lite)
       else docker compose available        → docker
       else                                 → refuse: "install Docker or point DATABASE_URL at a Postgres"
```

Steps are tagged `{ id, title, why, run }` and printed as a checklist before execution; `--dry-run` stops
there.

### 3.3 Execute (`tools/launcher/steps.mjs`)
Idempotent steps, each re-checks its precondition so `up` after `up` is a no-op:

| Step | Native | Docker |
|---|---|---|
| `.env` | copy `.env.example` if missing; fill `STORAGE_SIGNING_SECRET` (32 B random), `ADMIN_EMAIL` (prompt or `--admin`), `ADMIN_PASSWORD` (generated, printed once), `CONTACT_EMAIL`, `APP_URL`; write provider keys chosen by `--ai` | same |
| infra | start `postgres`/`redis` via compose **only for the ones not reachable**; wait for TCP + `pg_isready`-equivalent (TCP + auth-less connect) | `docker compose up -d` |
| deps | `pnpm install --frozen-lockfile` if `node_modules` is missing/stale (lockfile mtime), `pnpm db:generate` if `packages/db/generated` missing | image build |
| schema | `prisma migrate deploy` then `db:seed` (idempotent upserts) | web container entrypoint (already) |
| AI | `--ai local`: start `ollama serve` as a managed child if the binary exists and nothing listens; pull missing models through `POST /api/pull` with progress; `--ai <cloud>`: validate the key with one cheap request; `--ai none`: `LLM_PROVIDER=none` | `ollama` + `ollama-init` services (new) pull models; cloud keys via `.env` |
| render | Chromium present? else `npx playwright install chromium` (skippable → simple renderer) | in the worker image |
| app | dev: `next dev` + `tsx watch worker`; `--prod`: `next build` if `.next` older than sources, then `next start` + `tsx worker` | compose services |
| verify | probe `http://localhost:3000/login` 200 and `http://127.0.0.1:9464/healthz` 200; print URL + admin creds (first run) + `./jobradar status` | same probes against published ports |

### 3.4 Supervise (`tools/launcher/supervisor.mjs`)
- Children: `web`, `worker`, optionally `ollama`. stdout/stderr multiplexed with coloured prefixes; `LOG_FORMAT`
  passed through (pretty for dev, json for `--prod`).
- Restart policy: exponential backoff 1 s → 30 s, max 10 restarts / 10 min per child, then the launcher exits
  non-zero (systemd/compose take over in production).
- Health probes every 15 s (web `/login`, worker `/healthz`); three consecutive failures → restart that child.
- `SIGINT`/`SIGTERM`: forward `SIGTERM` to children, wait ≤ 30 s, then `SIGKILL`; stop compose services we
  started (`--keep-infra` leaves Postgres/Redis running, the default for `native` so data services are not
  bounced).
- State file `.jobradar/state.json` (pid, mode, ports, started infra) powers `status`, `logs` (tails
  `.jobradar/logs/*.log`) and `down`.

### 3.5 Docker as the single command
`docker-compose.yml` changes: `web`, `worker`, `backup` lose the `app` profile (default up); new
`ollama-init` job container pulls `LLM_MODEL` and `EMBEDDING_MODEL` through the `ollama` service and exits;
`web`/`worker` get `depends_on: ollama-init (service_completed_successfully)` **inside the `ai` profile**
only, so `docker compose up -d` (no AI, deterministic) and `docker compose --profile ai up -d` are both one
command. `./jobradar up --mode docker` is just that plus `.env` provisioning and the health wait.

### 3.6 Production hosts
`./jobradar systemd` writes `deploy/systemd/jobradar.service` that runs `./jobradar up --prod --mode native
--no-supervise-infra` under the `jobradar` user — a single unit instead of two, with the launcher's health
restarts inside and systemd's `Restart=always` outside.

## 4. Failure modes

| Situation | Behaviour |
|---|---|
| No Docker, no Postgres | refuse before touching anything; print the two ways out |
| Postgres reachable but wrong credentials | `migrate deploy` fails → step shows the Prisma error + `DATABASE_URL` hint; nothing else starts |
| Ollama binary missing, `--ai local` | warn, offer `--ai none` / cloud; continue with `LLM_PROVIDER=none` when `--yes` |
| Model pull interrupted | pull is resumable (Ollama layers); step re-runs next `up` |
| Port 3000 busy | pick next free port, print it, set `APP_URL` accordingly (dev only; prod refuses) |
| Worker crash-loops | 10 restarts / 10 min then exit 1 with the last 40 log lines |
| `pnpm install` needs network and there is none | step fails with "offline — run `pnpm install` when online"; `--skip-install` allowed when `node_modules` exists |

## 5. Verification
- `tools/launcher/launcher.test.ts`: `.env` parsing/merging/secret generation (comments preserved, no
  clobbering), `plan()` for seven fact fixtures, mode refusal, port fallback, compose command assembly, backoff
  schedule, state file round-trip.
- `./jobradar doctor` and `./jobradar up --dry-run` run in this sandbox (no Docker, no pnpm) and must print a
  correct refusal/plan.
- Online: `./jobradar up` on a fresh clone with Docker → `/login` 200 within 5 min including model pulls;
  `./jobradar up --prod` on the Mint box; `docker compose --profile ai up -d` alone.
