# all-unit

Generated 2026-11-02T05:46:00.390Z · 154 tests · **154 passed** · 0 failed · 0 skipped · 11983 ms


## apps/web/lib/job-serializer.test.ts

- ✅ serializeJob › parses JSON skills and serializes dates (13 ms)
- ✅ serializeJob › falls back to comma-separated skills (1 ms)

## apps/web/lib/openapi.test.ts

- ✅ OpenAPI ↔ routes › covers every route file and method (3 ms)
- ✅ OpenAPI ↔ routes › documents no phantom routes (0 ms)
- ✅ OpenAPI ↔ routes › every operation declares security and responses (8 ms)

## packages/crawler/src/ats-urls.test.ts

- ✅ atsRefFromUrl › detects every supported ATS from apply/careers URLs (3 ms)
- ✅ atsRefFromUrl › rejects non-ATS and structural path segments (1 ms)
- ✅ atsRefFromUrl › scans HTML for embedded boards (script src, iframes, links) (0 ms)
- ✅ apiUrlFor / costClassFor › builds list endpoints (0 ms)
- ✅ apiUrlFor / costClassFor › classes workday as expensive and the big four as cheap (1 ms)
- ✅ normalizeJobUrl › strips tracking params, fragments and trailing slashes; lowercases (1 ms)

## packages/crawler/src/crawler.service.test.ts

- ✅ source registry (single adapter map shared by worker + web) › resolves dedicated adapters by exact domain (1 ms)
- ✅ source registry (single adapter map shared by worker + web) › resolves company ATS domains by suffix (0 ms)
- ✅ source registry (single adapter map shared by worker + web) › no longer falls back to the heuristic link scraper for adapter-less Playwright sources (0 ms)
- ✅ source registry (single adapter map shared by worker + web) › marks multi-company ATS crawls as superseded by company boards (0 ms)
- ✅ source registry (single adapter map shared by worker + web) › reports missing adapters for unknown domains (0 ms)
- ✅ source registry (single adapter map shared by worker + web) › surfaces adapter-level availability issues (Wellfound anti-bot) (1 ms)

## packages/crawler/src/engines/engines.test.ts

- ✅ board engines — list parsing and external-id stability › registry exposes all supported engines (2 ms)
- ✅ board engines — list parsing and external-id stability › greenhouse: list without content; detail fetches content + salary metadata (41 ms)
- ✅ board engines — list parsing and external-id stability › lever: list includes description + salaryRange + workplaceType (6 ms)
- ✅ board engines — list parsing and external-id stability › ashby: posting API with compensation summary (3 ms)
- ✅ board engines — list parsing and external-id stability › workable: POST with paging token (6 ms)
- ✅ board engines — list parsing and external-id stability › workday: refuses unscoped boards; scoped POST carries searchText (4 ms)
- ✅ board engines — list parsing and external-id stability › external ids are stable across two fetches (no positional ids) (7 ms)

## packages/crawler/src/gateway/egress.test.ts

- ✅ egress guard (audit NEW-27) › classifies private / special addresses (1 ms)
- ✅ egress guard (audit NEW-27) › blocks schemes, internal names, literal private IPs and credentials (1 ms)
- ✅ egress guard (audit NEW-27) › blocks names that resolve to private addresses (incl. mixed public+private) and caches the verdict (1 ms)
- ✅ egress guard (audit NEW-27) › lets unresolvable names through (fetch fails on its own; sandbox fake fetch keeps working) (0 ms)
- ✅ egress guard (audit NEW-27) › readBodyCapped truncates oversized bodies (1 ms)

## packages/crawler/src/gateway/fetch-gateway.test.ts

- ✅ FetchGateway classification › 200 JSON → changed with etag/hash; same hash next time → unchanged; 304 → unchanged (112 ms)
- ✅ FetchGateway classification › 404 → not_found, 5xx → error, 403 → blocked (circuit opens 6h), challenge HTML on 200 → blocked (117 ms)
- ✅ FetchGateway classification › challenge page served with 200 to an API call is classified as blocked (2 ms)
- ✅ FetchGateway classification › 429 honours Retry-After and opens the circuit; half-open probe closes it on success (5 ms)
- ✅ FetchGateway politeness › sends the JobRadar UA and conditional headers (2 ms)
- ✅ FetchGateway politeness › enforces the daily budget and the probe budget (169 ms)
- ✅ FetchGateway politeness › probe budget is independent of the list budget (135 ms)
- ✅ FetchGateway politeness › respects robots.txt for HTML fetches only (5 ms)
- ✅ FetchGateway politeness › host kill switch stops all traffic immediately (1 ms)
- ✅ FetchGateway politeness › token bucket spaces requests by minIntervalMs after the burst (115 ms)
- ✅ FetchGateway politeness › logs a fetch_run per request with outcome + host (2 ms)

## packages/crawler/src/gateway/robots.test.ts

- ✅ parseRobots › picks the JobRadar group over * and parses allow/disallow/crawl-delay (0 ms)
- ✅ parseRobots › falls back to * and tolerates comments/blank lines (1 ms)
- ✅ parseRobots › empty file → allow everything (0 ms)

## packages/crawler/src/relevance.test.ts

- ✅ isRelevantRole (pre-extraction filter) › keeps software engineering titles including one-word Backend/Frontend/Fullstack (regression) (5 ms)
- ✅ isRelevantRole (pre-extraction filter) › drops non-engineering and non-software engineering roles (2 ms)
- ✅ isRelevantRole (pre-extraction filter) › uses context for ambiguous titles (1 ms)

## packages/extractor/src/classifier.test.ts

- ✅ classifyOpportunity — priority classes › P1: remote + worldwide/anywhere/APAC/overlap/EOR signals (7 ms)
- ✅ classifyOpportunity — priority classes › P1 uses the lever/ashby isRemote flag when the location line is a city (0 ms)
- ✅ classifyOpportunity — priority classes › none: remote but restricted to US/EU/UK etc. (reason recorded) (1 ms)
- ✅ classifyOpportunity — priority classes › restriction in the location line wins over an india-ok phrase in the body (0 ms)
- ✅ classifyOpportunity — priority classes › P2: remote with India in the location (0 ms)
- ✅ classifyOpportunity — priority classes › P3: HYBRID only, Delhi-NCR, company tagged mnc/big_tech (0 ms)
- ✅ classifyOpportunity — priority classes › india-HQ companies are excluded regardless of posting (0 ms)
- ✅ classifyOpportunity — priority classes › unknown HQ is allowed (0 ms)
- ✅ detectEmploymentType › uses ATS hints first, then title, then description (1 ms)
- ✅ helpers › isNcrLocation (1 ms)
- ✅ helpers › findRestriction returns the matched phrase (0 ms)

## packages/extractor/src/llm-extractor.test.ts

- ✅ llmExtract via LlmProvider › maps structured output into ExtractedJob and wraps the description as untrusted data (2 ms)
- ✅ llmExtract via LlmProvider › returns null when no provider is configured (0 ms)

## packages/extractor/src/normalizer.test.ts

- ✅ normalizeJob canonical hash › matches the same role across different source URLs (2 ms)
- ✅ normalizeJob canonical hash › distinguishes materially different locations (0 ms)
- ✅ normalizeJob canonical hash › ignores remoteType (text-derived, differs per source) so the same role hashes equal across sources (0 ms)
- ✅ normalizeJob canonical hash › normalises the apply URL (tracking params, fragment, trailing slash, case) (0 ms)
- ✅ normalizeJob canonical hash › derives city from the location line and does not confuse Ukraine with UK (1 ms)
- ✅ DedupeService.upsert › returns created=true once, then matches by normalised URL and never erases richer fields on re-sighting (2 ms)
- ✅ DedupeService.upsert › a closed job that reappears comes back as new (0 ms)

## packages/llm/src/llm.test.ts

- ✅ AnthropicProvider › forces tool use with the zod schema and validates the tool input (3 ms)
- ✅ AnthropicProvider › retries on 429/5xx then succeeds; schema-invalid output is a typed error (2212 ms)
- ✅ AnthropicProvider › refuses to start without an API key (0 ms)
- ✅ extractJson › handles fences, leading prose and trailing chatter (1 ms)
- ✅ PII masking › masks emails, phones, urls and names reversibly; leaves years alone (1 ms)
- ✅ PII masking › same value gets the same placeholder (0 ms)
- ✅ budget › meters calls and blocks when the per-user cap is hit (2 ms)
- ✅ untrusted() › wraps and strips nested tag attempts (0 ms)
- ✅ budget without Redis (inline mode, audit NEW-04) + response cache (GH-11) › MemoryBudgetStore enforces per-user caps and the cache short-circuits identical prompts (12 ms)

## packages/log/src/log.test.ts

- ✅ logger › redacts sensitive keys at any depth and serialises errors (9 ms)
- ✅ logger › emits console-compatible calls as structured records with bindings (1 ms)
- ✅ logger › respects the level threshold (0 ms)
- ✅ metrics › exposes counters, gauges and histograms in Prometheus text format (2 ms)
- ✅ metrics › gauge collectors run on scrape (0 ms)
- ✅ withTimeout › resolves and clears the timer (no dangling rejection) (41 ms)
- ✅ withTimeout › rejects with TimeoutError when exceeded (12 ms)

## packages/notifications/src/notification.service.test.ts

- ✅ NotificationService › instant classes are P1+P2 (P2 instant per decision) (0 ms)
- ✅ NotificationService › sends once per canonical hash (2 ms)
- ✅ NotificationService › caps at 10 per feed per hour and defers the rest (4 ms)
- ✅ NotificationService › does not record "sent" when Telegram is unconfigured (1 ms)
- ✅ NotificationService › message carries the class tag and strips markdown-breaking characters (1 ms)
- ✅ NotificationService › digest includes P3 + deferred, excludes instant-sent and internships (19 ms)
- ✅ NotificationService · per-user channels (audit NEW-03 / GH-6) › uses alert_channels when present: class + minScore filters, per-recipient dedupe, env channel ignored (1 ms)
- ✅ NotificationService · per-user channels (audit NEW-03 / GH-6) › follow-up reminders: due applications are announced once and the timeline records it (2 ms)

## packages/ranking/src/ranking.test.ts

- ✅ ranking v2 › class band dominates: P1 40 > P2 30 > P3 15 > none 0 (1 ms)
- ✅ ranking v2 › no salary does not block a high score (alerts no longer depend on score) (0 ms)
- ✅ ranking v2 › compensation bands from INR (1 ms)
- ✅ ranking v2 › freshness decays from first_seen_at at read time (0 ms)
- ✅ ranking v2 › quality maps 0..100 → 0..5 with a default of 50 (1 ms)
- ✅ role fit from profile (C5-7) › uses profile skills/titles when given, RANKING_CONFIG otherwise (0 ms)
- ✅ role fit from profile (C5-7) › falls back to RANKING_CONFIG when no profile row exists (1 ms)
- ✅ role fit from profile (C5-7) › single user: the profile drives the global base score (0 ms)
- ✅ role fit from profile (C5-7) › multi-user (audit NEW-03): no single profile may reorder the shared feed (0 ms)

## packages/resume/src/jd/jd.test.ts

- ✅ jd-v1 deterministic › sections a structured JD by headings; bullet lines are never headings (3 ms)
- ✅ jd-v1 deterministic › golden: required/preferred/years/title/seniority (pin — change deliberately) (27 ms)
- ✅ jd-v1 deterministic › unstructured JD: everything is required at 0.7 (2 ms)
- ✅ jd-v1 deterministic › helpers (0 ms)
- ✅ jd-v1 with LLM refinement › merges LLM additions without overriding deterministic evidence; falls back on failure (6 ms)

## packages/resume/src/parse/parse.test.ts

- ✅ extraction + parseability (PDF) › single-column resume parses cleanly with no warnings (6053 ms)
- ✅ extraction + parseability (PDF) › two-column layout is detected, reconstructed column-wise, and penalised (292 ms)
- ✅ extraction + parseability (PDF) › table-like rows and image-only pages are flagged (62 ms)
- ✅ extraction + parseability (PDF) › scanned (no text) document is a fatal warning (4 ms)
- ✅ extraction (DOCX) › extracts text and counts tables (56 ms)
- ✅ structuring › falls back to the heuristic parser when the LLM call fails (11 ms)
- ✅ structuring › masks PII before the LLM and restores it after; contacts backstopped deterministically (2 ms)
- ✅ structuring › without an LLM (model not running) the heuristic parser still structures the resume (1 ms)

## packages/resume/src/render/simple-pdf.test.ts

- ✅ simple PDF renderer (no Chromium) › produces a valid single-column PDF that round-trips through our own parser (176 ms)
- ✅ simple PDF renderer (no Chromium) › handles non-WinAnsi characters without breaking the file (69 ms)

## packages/resume/src/schema/resume.test.ts

- ✅ resume schema › fills defaults and validates dates (1 ms)
- ✅ resume schema › years of experience merges overlapping roles (2 ms)
- ✅ resume schema › text views separate experience from the skills list (0 ms)

## packages/resume/src/score/ats-v1.test.ts

- ✅ ats-v1 golden › pins the score and breakdown for the sample resume × JD (change deliberately, bump SCORER_VERSION) (19 ms)
- ✅ ats-v1 golden › evidence in experience outweighs a bare skills list (4 ms)
- ✅ ats-v1 golden › alternative groups: Go OR Java satisfied by either (1 ms)
- ✅ ats-v1 golden › parse warnings reduce parseability; stuffing and first person reduce quality (4 ms)
- ✅ ats-v1 golden › experience component compares years with the JD minimum (3 ms)
- ✅ ats-v1 golden › score is deterministic (3 ms)
- ✅ profile seed + quick match › seeds headline/about/skills/years/titles from the master resume (2 ms)
- ✅ profile seed + quick match › quick match is a weighted overlap of profile skills and job text (2 ms)

## packages/resume/src/search/synonyms.test.ts

- ✅ search fallback: role synonym expansion (no embedding model needed) › expands software-dev role queries (5 ms)
- ✅ search fallback: role synonym expansion (no embedding model needed) › strips seniority and expands skill aliases; leaves unknown terms alone (6 ms)

## packages/resume/src/semantic/vector-index.test.ts

- ✅ JobVectorIndex (audit NEW-08) › picks up re-embedded (upserted) vectors via updatedAt and evicts closed/deleted jobs on reconcile (5 ms)
- ✅ JobVectorIndex (audit NEW-08) › evict / evictOwner drop all chunks of a job (1 ms)

## packages/resume/src/services/erasure.service.test.ts

- ✅ ErasureService › eraseUser removes profile + version vectors, the file prefix and the user row; job vectors untouched (5 ms)
- ✅ ErasureService › eraseResume only touches that resume (scoped by user) and returns null for another user (2 ms)
- ✅ ErasureService › eraseResumeVersions deletes rendered files + vectors for retention (3 ms)
- ✅ ErasureService › pruneClosedJobVectors removes vectors of long-closed jobs and of jobs whose row is gone (4 ms)
- ✅ ErasureService › sweepOrphanVectors catches vectors whose owner vanished through any path (4 ms)
- ✅ ErasureService.sweepOrphanFiles (audit NEW-22) › removes unreferenced files, keeps referenced ones and in-flight uploads (2 ms)

## packages/resume/src/skills/aliases.test.ts

- ✅ skill aliases › canonicalises common spellings (1 ms)
- ✅ skill aliases › matches with punctuation-safe boundaries and case rules (1 ms)
- ✅ skill aliases › does not match inside other words (0 ms)

## packages/storage/src/storage.test.ts

- ✅ LocalFsStore contract › put/head/get/delete round-trip (15 ms)
- ✅ LocalFsStore contract › deletePrefix erases everything under a user (33 ms)
- ✅ LocalFsStore contract › rejects unsafe keys (1 ms)
- ✅ LocalFsStore signed urls › signs with expiry and verifies; tampering or expiry fails (2 ms)
- ✅ LocalFsStore.list / mtime (audit NEW-22 orphan sweeps) › lists keys under a prefix without sidecars or temp files (115 ms)

## packages/watchlist/src/jd-hydration.service.test.ts

- ✅ JdHydrationService › greenhouse apply URL → detail API (entity-escaped content decoded) (12 ms)
- ✅ JdHydrationService › lever → single posting endpoint; ashby → list lookup by id (12 ms)
- ✅ JdHydrationService › non-ATS URL → HTML main-content extraction through the gateway; nothing usable → null (8 ms)
- ✅ JdHydrationService › helpers (1 ms)

## packages/watchlist/src/sighting.service.test.ts

- ✅ SightingService.reconcile (full-list feeds) › new → seen → missing×2 → gone → job closed; reappearance reopens (5 ms)
- ✅ SightingService.reconcile (full-list feeds) › confirmMissing advances counters on unchanged polls (1 ms)
- ✅ SightingService.reconcile (full-list feeds) › a failed poll never counts (caller simply does not call reconcile) (1 ms)
- ✅ SightingService.reconcile (full-list feeds) › suspect drop (>50% shrink from ≥10) suspends closures (1 ms)
- ✅ SightingService.reconcile (full-list feeds) › payload change is reported as changed, not new (0 ms)
- ✅ SightingService.reconcile (full-list feeds) › keeps jobs.first_seen_at = earliest sighting across feeds (1 ms)
- ✅ SightingService.reconcile (windowed feeds) › never marks anything gone (1 ms)
