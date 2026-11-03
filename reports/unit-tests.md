# unit-tests

Generated 2026-11-02T08:50:23.429Z · 215 tests · **215 passed** · 0 failed · 0 skipped · 16455 ms


## apps/web/lib/job-serializer.test.ts

- ✅ serializeJob › parses JSON skills and serializes dates (2 ms)
- ✅ serializeJob › falls back to comma-separated skills (0 ms)

## apps/web/lib/openapi.test.ts

- ✅ OpenAPI ↔ routes › covers every route file and method (3 ms)
- ✅ OpenAPI ↔ routes › documents no phantom routes (0 ms)
- ✅ OpenAPI ↔ routes › every operation declares security and responses (10 ms)

## apps/web/lib/resume-editor.test.ts

- ✅ resume editor state (browser logic, tested headless) › edits paths, tracks dirty/changes, resets (2 ms)
- ✅ resume editor state (browser logic, tested headless) › live score moves when a missing required skill is added, and suggestion gains are computed on the draft (20 ms)
- ✅ resume editor state (browser logic, tested headless) › applies a bullet rewrite, undoes it LIFO, refuses non-applicable kinds (3 ms)
- ✅ resume editor state (browser logic, tested headless) › drafts persist to storage only while dirty (1 ms)

## packages/crawler/src/ats-urls.test.ts

- ✅ atsRefFromUrl › detects every supported ATS from apply/careers URLs (4 ms)
- ✅ atsRefFromUrl › rejects non-ATS and structural path segments (0 ms)
- ✅ atsRefFromUrl › scans HTML for embedded boards (script src, iframes, links) (1 ms)
- ✅ apiUrlFor / costClassFor › builds list endpoints (0 ms)
- ✅ apiUrlFor / costClassFor › classes workday as expensive and the big four as cheap (1 ms)
- ✅ normalizeJobUrl › strips tracking params, fragments and trailing slashes; lowercases (1 ms)

## packages/crawler/src/crawler.service.test.ts

- ✅ source registry (single adapter map shared by worker + web) › resolves dedicated adapters by exact domain (0 ms)
- ✅ source registry (single adapter map shared by worker + web) › resolves company ATS domains by suffix (0 ms)
- ✅ source registry (single adapter map shared by worker + web) › no longer falls back to the heuristic link scraper for adapter-less Playwright sources (0 ms)
- ✅ source registry (single adapter map shared by worker + web) › marks multi-company ATS crawls as superseded by company boards (1 ms)
- ✅ source registry (single adapter map shared by worker + web) › reports missing adapters for unknown domains (0 ms)
- ✅ source registry (single adapter map shared by worker + web) › surfaces adapter-level availability issues (Wellfound anti-bot) (0 ms)

## packages/crawler/src/engines/engines.test.ts

- ✅ board engines — list parsing and external-id stability › registry exposes all supported engines (2 ms)
- ✅ board engines — list parsing and external-id stability › greenhouse: list without content; detail fetches content + salary metadata (37 ms)
- ✅ board engines — list parsing and external-id stability › lever: list includes description + salaryRange + workplaceType (3 ms)
- ✅ board engines — list parsing and external-id stability › ashby: posting API with compensation summary (5 ms)
- ✅ board engines — list parsing and external-id stability › workable: POST with paging token (7 ms)
- ✅ board engines — list parsing and external-id stability › workday: refuses unscoped boards; scoped POST carries searchText (3 ms)
- ✅ board engines — list parsing and external-id stability › external ids are stable across two fetches (no positional ids) (6 ms)

## packages/crawler/src/gateway/egress.test.ts

- ✅ egress guard (audit NEW-27) › classifies private / special addresses (1 ms)
- ✅ egress guard (audit NEW-27) › blocks schemes, internal names, literal private IPs and credentials (2 ms)
- ✅ egress guard (audit NEW-27) › blocks names that resolve to private addresses (incl. mixed public+private) and caches the verdict (1 ms)
- ✅ egress guard (audit NEW-27) › lets unresolvable names through (fetch fails on its own; sandbox fake fetch keeps working) (0 ms)
- ✅ egress guard (audit NEW-27) › readBodyCapped truncates oversized bodies (1 ms)

## packages/crawler/src/gateway/fetch-gateway.test.ts

- ✅ FetchGateway classification › 200 JSON → changed with etag/hash; same hash next time → unchanged; 304 → unchanged (129 ms)
- ✅ FetchGateway classification › 404 → not_found, 5xx → error, 403 → blocked (circuit opens 6h), challenge HTML on 200 → blocked (83 ms)
- ✅ FetchGateway classification › challenge page served with 200 to an API call is classified as blocked (2 ms)
- ✅ FetchGateway classification › 429 honours Retry-After and opens the circuit; half-open probe closes it on success (4 ms)
- ✅ FetchGateway politeness › sends the JobRadar UA and conditional headers (2 ms)
- ✅ FetchGateway politeness › enforces the daily budget and the probe budget (255 ms)
- ✅ FetchGateway politeness › probe budget is independent of the list budget (63 ms)
- ✅ FetchGateway politeness › respects robots.txt for HTML fetches only (6 ms)
- ✅ FetchGateway politeness › host kill switch stops all traffic immediately (2 ms)
- ✅ FetchGateway politeness › token bucket spaces requests by minIntervalMs after the burst (150 ms)
- ✅ FetchGateway politeness › logs a fetch_run per request with outcome + host (2 ms)

## packages/crawler/src/gateway/robots.test.ts

- ✅ parseRobots › picks the JobRadar group over * and parses allow/disallow/crawl-delay (1 ms)
- ✅ parseRobots › falls back to * and tolerates comments/blank lines (0 ms)
- ✅ parseRobots › empty file → allow everything (0 ms)

## packages/crawler/src/relevance.test.ts

- ✅ isRelevantRole (pre-extraction filter) › keeps software engineering titles including one-word Backend/Frontend/Fullstack (regression) (4 ms)
- ✅ isRelevantRole (pre-extraction filter) › drops non-engineering and non-software engineering roles (2 ms)
- ✅ isRelevantRole (pre-extraction filter) › uses context for ambiguous titles (0 ms)

## packages/extractor/src/classifier.test.ts

- ✅ classifyOpportunity — priority classes › P1: remote + worldwide/anywhere/APAC/overlap/EOR signals (6 ms)
- ✅ classifyOpportunity — priority classes › P1 uses the lever/ashby isRemote flag when the location line is a city (1 ms)
- ✅ classifyOpportunity — priority classes › none: remote but restricted to US/EU/UK etc. (reason recorded) (1 ms)
- ✅ classifyOpportunity — priority classes › restriction in the location line wins over an india-ok phrase in the body (0 ms)
- ✅ classifyOpportunity — priority classes › P2: remote with India in the location (0 ms)
- ✅ classifyOpportunity — priority classes › P3: HYBRID only, Delhi-NCR, company tagged mnc/big_tech (1 ms)
- ✅ classifyOpportunity — priority classes › india-HQ companies are excluded regardless of posting (0 ms)
- ✅ classifyOpportunity — priority classes › unknown HQ is allowed (0 ms)
- ✅ detectEmploymentType › uses ATS hints first, then title, then description (1 ms)
- ✅ helpers › isNcrLocation (0 ms)
- ✅ helpers › findRestriction returns the matched phrase (0 ms)

## packages/extractor/src/geo/facts.test.ts

- ✅ job facts reproduce the legacy classifier (golden gate, HLD §4) › every classifier fixture maps to the same tier through facts + legacy preset (77 ms)
- ✅ structured geo facts › parses location lines into country / metro / region (0 ms)
- ✅ structured geo facts › restriction phrases become exclusive allow lists and eligibility is per country (1 ms)
- ✅ structured geo facts › region restrictions expand to member countries (0 ms)
- ✅ structured geo facts › timezone windows are evaluated against the candidate offset (1 ms)
- ✅ structured geo facts › worldwide beats a body restriction; location-line restriction beats everything (0 ms)
- ✅ structured geo facts › salary carries a USD pivot (1 ms)

## packages/extractor/src/llm-extractor.test.ts

- ✅ llmExtract via LlmProvider › maps structured output into ExtractedJob and wraps the description as untrusted data (2 ms)
- ✅ llmExtract via LlmProvider › returns null when no provider is configured (0 ms)

## packages/extractor/src/normalizer.test.ts

- ✅ normalizeJob canonical hash › matches the same role across different source URLs (2 ms)
- ✅ normalizeJob canonical hash › distinguishes materially different locations (1 ms)
- ✅ normalizeJob canonical hash › ignores remoteType (text-derived, differs per source) so the same role hashes equal across sources (0 ms)
- ✅ normalizeJob canonical hash › normalises the apply URL (tracking params, fragment, trailing slash, case) (0 ms)
- ✅ normalizeJob canonical hash › derives city from the location line and does not confuse Ukraine with UK (2 ms)
- ✅ DedupeService.upsert › returns created=true once, then matches by normalised URL and never erases richer fields on re-sighting (2 ms)
- ✅ DedupeService.upsert › a closed job that reappears comes back as new (1 ms)

## packages/llm/src/llm.test.ts

- ✅ AnthropicProvider › forces tool use with the zod schema and validates the tool input (1 ms)
- ✅ AnthropicProvider › retries on 429/5xx then succeeds; schema-invalid output is a typed error (2060 ms)
- ✅ AnthropicProvider › refuses to start without an API key (0 ms)
- ✅ extractJson › handles fences, leading prose and trailing chatter (2 ms)
- ✅ PII masking › masks emails, phones, urls and names reversibly; leaves years alone (1 ms)
- ✅ PII masking › same value gets the same placeholder (0 ms)
- ✅ budget › meters calls and blocks when the per-user cap is hit (2 ms)
- ✅ untrusted() › wraps and strips nested tag attempts (0 ms)
- ✅ budget without Redis (inline mode, audit NEW-04) + response cache (GH-11) › MemoryBudgetStore enforces per-user caps and the cache short-circuits identical prompts (10 ms)

## packages/llm/src/providers.test.ts

- ✅ QuotaLimiter (client-side free-tier guard) › enforces per-minute and per-day windows and rolls them over (1 ms)
- ✅ OpenAICompatProvider › gemini preset: json_schema response_format, bearer key, cost 0 on the free tier, quota recorded (3 ms)
- ✅ OpenAICompatProvider › groq preset: json_object mode puts the schema in the system prompt, fenced output is parsed, TPM cap trims long prompts (2 ms)
- ✅ OpenAICompatProvider › 429 beyond retries becomes a non-retryable budget error (chain moves on); 401 disables the provider (2 ms)
- ✅ OpenAICompatProvider › client-side quota stops calls before the provider does (0 ms)
- ✅ OpenAICompatProvider › schema-invalid output is a typed schema error; missing key is a config error at construction (2 ms)
- ✅ OpenAICompatProvider › status(): /models reachability and key validity without spending tokens (1 ms)
- ✅ ChainProvider (ordered fallback + data-use policy) › public purposes go to the first provider; resume-derived purposes skip may-train providers (1 ms)
- ✅ ChainProvider (ordered fallback + data-use policy) › operator opt-in (piiAllowed) lets a may-train provider see resume text (0 ms)
- ✅ ChainProvider (ordered fallback + data-use policy) › budget/http/timeout errors fall through; http/timeout put the member in cooldown; schema errors do not fall through (2 ms)
- ✅ ChainProvider (ordered fallback + data-use policy) › when every member is skipped or failing, the error lists each reason (0 ms)
- ✅ createLlmProvider / describeLlm (env wiring) › parses a comma-separated chain, applies LLM_PII_PROVIDERS, and enforces the policy even on a lone may-train provider (2 ms)
- ✅ createLlmProvider / describeLlm (env wiring) › describeLlm reports each member with kind, data-use, PII eligibility and quota (1 ms)
- ✅ OpenAICompatEmbeddingProvider › embeds in order, normalises, and is selected by EMBEDDING_PROVIDER=<preset> (1 ms)

## packages/log/src/log.test.ts

- ✅ logger › redacts sensitive keys at any depth and serialises errors (6 ms)
- ✅ logger › emits console-compatible calls as structured records with bindings (1 ms)
- ✅ logger › respects the level threshold (0 ms)
- ✅ metrics › exposes counters, gauges and histograms in Prometheus text format (1 ms)
- ✅ metrics › gauge collectors run on scrape (1 ms)
- ✅ withTimeout › resolves and clears the timer (no dangling rejection) (41 ms)
- ✅ withTimeout › rejects with TimeoutError when exceeded (11 ms)

## packages/notifications/src/notification.service.test.ts

- ✅ NotificationService › instant classes are P1+P2 (P2 instant per decision) (0 ms)
- ✅ NotificationService › sends once per canonical hash (2 ms)
- ✅ NotificationService › caps at 10 per feed per hour and defers the rest (5 ms)
- ✅ NotificationService › does not record "sent" when Telegram is unconfigured (1 ms)
- ✅ NotificationService › message carries the class tag and strips markdown-breaking characters (0 ms)
- ✅ NotificationService › digest includes P3 + deferred, excludes instant-sent and internships (3 ms)
- ✅ NotificationService · per-user channels (audit NEW-03 / GH-6) › uses alert_channels when present: class + minScore filters, per-recipient dedupe, env channel ignored (2 ms)
- ✅ NotificationService · per-user channels (audit NEW-03 / GH-6) › follow-up reminders: due applications are announced once and the timeline records it (2 ms)
- ✅ NotificationService · per-user digest hour (v5) › serves each recipient at their own hour/timezone; env recipients at 08:00 IST (35 ms)

## packages/prefs/src/evaluate.test.ts

- ✅ evaluate × legacy preset reproduces the v1–v4 classifier (golden gate) › same class for every fixture (9 ms)
- ✅ evaluate × legacy preset reproduces the v1–v4 classifier (golden gate) › score components mirror the legacy ranking bands (1 ms)
- ✅ evaluate is per user › a US-only posting is tier1 for a US preset and excluded-by-eligibility for the India preset (1 ms)
- ✅ evaluate is per user › hybrid metros and company tags follow the document (0 ms)
- ✅ evaluate is per user › pay floor and employment type exclusions are explained (6 ms)
- ✅ evaluate is per user › pay bands convert through USD into the user currency (1 ms)
- ✅ evaluate is per user › legacyDocFromEnv honours PAY_FLOOR_INR and INSTANT_ALERT_CLASSES (1 ms)

## packages/prefs/src/services/services.test.ts

- ✅ PreferencesService › seeds the owner from the legacy env, keeps history, reverts, and applies presets without moving home (6 ms)
- ✅ EvalService › evaluates a job for every active user with their own tiers, and re-evaluation is idempotent per version (11 ms)
- ✅ EvalService › derives facts for pre-v5 jobs without a facts row and previews without writing (3 ms)
- ✅ CrawlScopeService (union of users) › computes excluded HQs as the intersection, the lowest pay floor in USD, metros as the union; single-user auto-applies Workday scopes (3 ms)

## packages/ranking/src/ranking.test.ts

- ✅ ranking v2 › class band dominates: P1 40 > P2 30 > P3 15 > none 0 (1 ms)
- ✅ ranking v2 › no salary does not block a high score (alerts no longer depend on score) (0 ms)
- ✅ ranking v2 › compensation bands from INR (0 ms)
- ✅ ranking v2 › freshness decays from first_seen_at at read time (1 ms)
- ✅ ranking v2 › quality maps 0..100 → 0..5 with a default of 50 (0 ms)
- ✅ role fit from profile (C5-7) › uses profile skills/titles when given, RANKING_CONFIG otherwise (1 ms)
- ✅ role fit from profile (C5-7) › falls back to RANKING_CONFIG when no profile row exists (0 ms)
- ✅ role fit from profile (C5-7) › single user: the profile drives the global base score (0 ms)
- ✅ role fit from profile (C5-7) › multi-user (audit NEW-03): no single profile may reorder the shared feed (0 ms)

## packages/resume/src/jd/jd.test.ts

- ✅ jd-v1 deterministic › sections a structured JD by headings; bullet lines are never headings (0 ms)
- ✅ jd-v1 deterministic › golden: required/preferred/years/title/seniority (pin — change deliberately) (2 ms)
- ✅ jd-v1 deterministic › unstructured JD: everything is required at 0.7 (1 ms)
- ✅ jd-v1 deterministic › helpers (0 ms)
- ✅ jd-v1 with LLM refinement › merges LLM additions without overriding deterministic evidence; falls back on failure (3 ms)

## packages/resume/src/parse/parse.test.ts

- ✅ extraction + parseability (PDF) › single-column resume parses cleanly with no warnings (7469 ms)
- ✅ extraction + parseability (PDF) › two-column layout is detected, reconstructed column-wise, and penalised (64 ms)
- ✅ extraction + parseability (PDF) › table-like rows and image-only pages are flagged (20 ms)
- ✅ extraction + parseability (PDF) › scanned (no text) document is a fatal warning (4 ms)
- ✅ extraction (DOCX) › extracts text and counts tables (49 ms)
- ✅ structuring › falls back to the heuristic parser when the LLM call fails (11 ms)
- ✅ structuring › masks PII before the LLM and restores it after; contacts backstopped deterministically (1 ms)
- ✅ structuring › without an LLM (model not running) the heuristic parser still structures the resume (4 ms)

## packages/resume/src/render/simple-pdf.test.ts

- ✅ simple PDF renderer (no Chromium) › produces a valid single-column PDF that round-trips through our own parser (51 ms)
- ✅ simple PDF renderer (no Chromium) › handles non-WinAnsi characters without breaking the file (34 ms)

## packages/resume/src/schema/resume.test.ts

- ✅ resume schema › fills defaults and validates dates (1 ms)
- ✅ resume schema › years of experience merges overlapping roles (0 ms)
- ✅ resume schema › text views separate experience from the skills list (0 ms)

## packages/resume/src/score/ats-v1.test.ts

- ✅ ats-v1 golden › pins the score and breakdown for the sample resume × JD (change deliberately, bump SCORER_VERSION) (2 ms)
- ✅ ats-v1 golden › evidence in experience outweighs a bare skills list (2 ms)
- ✅ ats-v1 golden › alternative groups: Go OR Java satisfied by either (1 ms)
- ✅ ats-v1 golden › parse warnings reduce parseability; stuffing and first person reduce quality (2 ms)
- ✅ ats-v1 golden › experience component compares years with the JD minimum (1 ms)
- ✅ ats-v1 golden › score is deterministic (1 ms)
- ✅ profile seed + quick match › seeds headline/about/skills/years/titles from the master resume (1 ms)
- ✅ profile seed + quick match › quick match is a weighted overlap of profile skills and job text (2 ms)

## packages/resume/src/search/synonyms.test.ts

- ✅ search fallback: role synonym expansion (no embedding model needed) › expands software-dev role queries (5 ms)
- ✅ search fallback: role synonym expansion (no embedding model needed) › strips seniority and expands skill aliases; leaves unknown terms alone (4 ms)

## packages/resume/src/semantic/vector-index.test.ts

- ✅ JobVectorIndex (audit NEW-08) › picks up re-embedded (upserted) vectors via updatedAt and evicts closed/deleted jobs on reconcile (2 ms)
- ✅ JobVectorIndex (audit NEW-08) › evict / evictOwner drop all chunks of a job (1 ms)

## packages/resume/src/services/erasure.service.test.ts

- ✅ ErasureService › eraseUser removes profile + version vectors, the file prefix and the user row; job vectors untouched (2 ms)
- ✅ ErasureService › eraseResume only touches that resume (scoped by user) and returns null for another user (1 ms)
- ✅ ErasureService › eraseResumeVersions deletes rendered files + vectors for retention (1 ms)
- ✅ ErasureService › pruneClosedJobVectors removes vectors of long-closed jobs and of jobs whose row is gone (1 ms)
- ✅ ErasureService › sweepOrphanVectors catches vectors whose owner vanished through any path (2 ms)
- ✅ ErasureService.sweepOrphanFiles (audit NEW-22) › removes unreferenced files, keeps referenced ones and in-flight uploads (1 ms)

## packages/resume/src/skills/aliases.test.ts

- ✅ skill aliases › canonicalises common spellings (1 ms)
- ✅ skill aliases › matches with punctuation-safe boundaries and case rules (0 ms)
- ✅ skill aliases › does not match inside other words (0 ms)

## packages/resume/src/version/editor.test.ts

- ✅ editor helpers (HLD-resume-editor) › diffContent attributes every change to a JSON pointer (0 ms)
- ✅ editor helpers (HLD-resume-editor) › groundChanges flags claims that are not in the master, but not contact/date fields (7 ms)
- ✅ editor helpers (HLD-resume-editor) › bullet / keyword text round-trips and JSON pointers work (1 ms)

## packages/storage/src/storage.test.ts

- ✅ LocalFsStore contract › put/head/get/delete round-trip (8 ms)
- ✅ LocalFsStore contract › deletePrefix erases everything under a user (7 ms)
- ✅ LocalFsStore contract › rejects unsafe keys (0 ms)
- ✅ LocalFsStore signed urls › signs with expiry and verifies; tampering or expiry fails (1 ms)
- ✅ LocalFsStore.list / mtime (audit NEW-22 orphan sweeps) › lists keys under a prefix without sidecars or temp files (13 ms)

## packages/watchlist/src/jd-hydration.service.test.ts

- ✅ JdHydrationService › greenhouse apply URL → detail API (entity-escaped content decoded) (4 ms)
- ✅ JdHydrationService › lever → single posting endpoint; ashby → list lookup by id (6 ms)
- ✅ JdHydrationService › non-ATS URL → HTML main-content extraction through the gateway; nothing usable → null (7 ms)
- ✅ JdHydrationService › helpers (1 ms)

## packages/watchlist/src/sighting.service.test.ts

- ✅ SightingService.reconcile (full-list feeds) › new → seen → missing×2 → gone → job closed; reappearance reopens (2 ms)
- ✅ SightingService.reconcile (full-list feeds) › confirmMissing advances counters on unchanged polls (1 ms)
- ✅ SightingService.reconcile (full-list feeds) › a failed poll never counts (caller simply does not call reconcile) (1 ms)
- ✅ SightingService.reconcile (full-list feeds) › suspect drop (>50% shrink from ≥10) suspends closures (0 ms)
- ✅ SightingService.reconcile (full-list feeds) › payload change is reported as changed, not new (1 ms)
- ✅ SightingService.reconcile (full-list feeds) › keeps jobs.first_seen_at = earliest sighting across feeds (0 ms)
- ✅ SightingService.reconcile (windowed feeds) › never marks anything gone (1 ms)

## tools/launcher/launcher.test.ts

- ✅ .env parsing and merging › parses values, strips inline comments, honours quotes (1 ms)
- ✅ .env parsing and merging › merges in place keeping comments/order and appends unknown keys under a header (1 ms)
- ✅ .env parsing and merging › provision() fills only what is empty: secrets generated once, admin answer applied, nothing clobbered (1 ms)
- ✅ .env parsing and merging › aiEnv() produces the documented chains and PII policy (1 ms)
- ✅ plan(): decision table › fresh laptop (Docker + pnpm, nothing running, no .env): native mode with compose for data services, full bootstrap (3 ms)
- ✅ plan(): decision table › warm server (everything reachable, deps fresh): only migrate → seed → app → verify; no .env write (0 ms)
- ✅ plan(): decision table › nothing to run on: no Postgres, no Docker → refusal with both ways out (1 ms)
- ✅ plan(): decision table › Docker but no pnpm → docker mode: compose with the ai profile, then health wait; no supervision (0 ms)
- ✅ plan(): decision table › --mode lite: web only with QUEUE_MODE=inline, Redis ignored, no Chromium step (0 ms)
- ✅ plan(): decision table › Redis down and no Docker → degrade to inline for this run (not persisted) with a warning (1 ms)
- ✅ plan(): decision table › Ollama not installed: AI falls back for this run; --ai gemini persists the chain + key and warns about the missing key (0 ms)
- ✅ plan(): decision table › --prod: builds when missing/stale, refuses a busy port; dev moves to 3001 (1 ms)
- ✅ plan(): decision table › explicit --mode that is impossible is refused with a specific reason (0 ms)
- ✅ plan(): decision table › --skip-install / --skip-chromium turn steps into warnings (0 ms)
- ✅ steps + supervisor helpers › composeArgs builds the right docker compose command (1 ms)
- ✅ steps + supervisor helpers › appProcesses: dev vs prod commands, env overrides, worker only with bullmq (0 ms)
- ✅ steps + supervisor helpers › backoff: 1 s → 30 s cap, gives up after 10 restarts in the window (0 ms)
- ✅ steps + supervisor helpers › state file round-trips and clears (2 ms)

## tools/launcher/steps.test.ts

- ✅ stepOllamaPull › skips present models, streams progress for missing ones, fails on an error line (33 ms)
- ✅ stepEnv › creates .env from .env.example on first run and merges the planned updates (2 ms)

## tools/launcher/supervisor.test.ts

- ✅ Supervisor (real children) › starts children, restarts a crasher with backoff, probes health, stops gracefully and clears state (4038 ms)
