# launcher

Generated 2026-11-02T08:49:16.311Z · 18 tests · **18 passed** · 0 failed · 0 skipped · 253 ms


## tools/launcher/launcher.test.ts

- ✅ .env parsing and merging › parses values, strips inline comments, honours quotes (2 ms)
- ✅ .env parsing and merging › merges in place keeping comments/order and appends unknown keys under a header (1 ms)
- ✅ .env parsing and merging › provision() fills only what is empty: secrets generated once, admin answer applied, nothing clobbered (2 ms)
- ✅ .env parsing and merging › aiEnv() produces the documented chains and PII policy (1 ms)
- ✅ plan(): decision table › fresh laptop (Docker + pnpm, nothing running, no .env): native mode with compose for data services, full bootstrap (2 ms)
- ✅ plan(): decision table › warm server (everything reachable, deps fresh): only migrate → seed → app → verify; no .env write (0 ms)
- ✅ plan(): decision table › nothing to run on: no Postgres, no Docker → refusal with both ways out (1 ms)
- ✅ plan(): decision table › Docker but no pnpm → docker mode: compose with the ai profile, then health wait; no supervision (1 ms)
- ✅ plan(): decision table › --mode lite: web only with QUEUE_MODE=inline, Redis ignored, no Chromium step (0 ms)
- ✅ plan(): decision table › Redis down and no Docker → degrade to inline for this run (not persisted) with a warning (1 ms)
- ✅ plan(): decision table › Ollama not installed: AI falls back for this run; --ai gemini persists the chain + key and warns about the missing key (2 ms)
- ✅ plan(): decision table › --prod: builds when missing/stale, refuses a busy port; dev moves to 3001 (1 ms)
- ✅ plan(): decision table › explicit --mode that is impossible is refused with a specific reason (0 ms)
- ✅ plan(): decision table › --skip-install / --skip-chromium turn steps into warnings (0 ms)
- ✅ steps + supervisor helpers › composeArgs builds the right docker compose command (0 ms)
- ✅ steps + supervisor helpers › appProcesses: dev vs prod commands, env overrides, worker only with bullmq (1 ms)
- ✅ steps + supervisor helpers › backoff: 1 s → 30 s cap, gives up after 10 restarts in the window (0 ms)
- ✅ steps + supervisor helpers › state file round-trips and clears (3 ms)
