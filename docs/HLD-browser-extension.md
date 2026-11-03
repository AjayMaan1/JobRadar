# HLD — Browser autofill extension (C12)

Goal: on the employer's application page, fill the standard fields, attach the chosen resume version and paste
the drafted answers / cover note from JobRadar — **the user reviews and clicks Submit**. Nothing is submitted by
the extension (ToS, CAPTCHAs, duplicate-application risk; HLD-apply-portal-v3 §2.2 tier B).

## 1. Architecture

```
┌───────────────────────── browser (Chrome / Edge / Brave, MV3; Firefox-compatible APIs) ─────────────────────────┐
│                                                                                                                  │
│  employer ATS page (greenhouse / lever / ashby / workable / generic)                                              │
│  ┌──────────────────────────────────────────────┐     chrome.runtime messages      ┌──────────────────────────┐  │
│  │ content script  (content.js)                 │◄────────────────────────────────►│ service worker (sw.js)   │  │
│  │  · detect ATS from host/DOM                  │  { type:'fill', kit }            │  · token + base URL      │  │
│  │  · field maps per ATS + generic heuristics   │  { type:'report', filled[] }     │    (chrome.storage)      │  │
│  │  · set values React-safely (native setter +  │                                  │  · GET  /api/ext/apply-kit│ │
│  │    input/change events), selects, radios     │                                  │  · GET  file (bearer)    │  │
│  │  · attach resume via DataTransfer on <input  │                                  │  · POST /api/ext/applied │  │
│  │    type=file>                                │                                  │  · badge: ✓ job matched  │  │
│  │  · highlight filled fields, NEVER submit     │                                  └─────────────┬────────────┘  │
│  └──────────────────────────────────────────────┘                                                │               │
│  popup.html: job match · "Fill this form" · "Attach resume" · answers list (copy) · "Mark applied" │               │
│  options.html: JobRadar URL · pairing token · test connection                                      │               │
└──────────────────────────────────────────────────────────────────────────────────────────────────┼───────────────┘
                                                                                                   │ Authorization: Bearer <ext token>
                                                                                                   ▼
┌────────────────────────────── JobRadar web (apps/web) ───────────────────────────────────────────────────────────┐
│ /api/ext/*  (CORS for chrome-extension:// / moz-extension:// origins, OPTIONS preflight, bearer only)            │
│   POST /api/ext/pair        (cookie session) → one-time extension token (auth_tokens.kind=extension, 180 d)      │
│   GET  /api/ext/me          → { user, app }                                                                      │
│   GET  /api/ext/apply-kit?url=<page url>                                                                         │
│        → resolve job (applyUrlNormalized → ATS job id → null) → { job, ats, fieldHints, profile, files,         │
│          answers, coverNote, headline, about, application }                                                      │
│   POST /api/ext/applied     { jobId, resumeVersionId, answers, coverNote } → Application(submittedVia=extension) │
│ /api/files?key&exp&sig      (bearer accepted) → resume PDF/DOCX bytes                                             │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## 2. Pairing & security

- The user creates a token on *Profile → Account → Browser extension* (`POST /api/ext/pair`, cookie session
  required; token shown once; revocable there; 180-day expiry). The extension stores it in
  `chrome.storage.local` (never synced).
- All `/api/ext/*` calls are bearer-only and rate-limited per user; the same `limitUser()` buckets apply.
- CORS: `Access-Control-Allow-Origin` echoes only `chrome-extension://…` / `moz-extension://…` origins (or
  `EXTENSION_ORIGINS` allow-list); credentials are never cookies, so CSRF does not apply.
- The extension requests host permissions only for the ATS domains it can fill plus the JobRadar origin the
  user configures (optional host permission granted at pairing).
- Nothing leaves the browser except calls to the user's own JobRadar instance; no third-party telemetry.

## 3. Field mapping

A `FieldSpec` = `{ key, selectors[] , kind: text|email|tel|url|textarea|select|file|radio }`. Per ATS:

| ATS | Detection | Mapped fields |
|---|---|---|
| Greenhouse | host `*.greenhouse.io`, `#application_form` / `#application-form` | first/last name, email, phone, location, LinkedIn, website, resume file, cover letter text, custom question textareas by label |
| Lever | host `jobs.lever.co` | name (single), email, phone, current company, LinkedIn, GitHub, portfolio, resume file, additional information |
| Ashby | host `jobs.ashbyhq.com` | name, email, phone, LinkedIn, website, resume file (then Ashby parses), custom labels |
| Workable | host `apply.workable.com` | first/last, email, phone, address, LinkedIn, resume file, summary/cover letter |
| Generic | anything else | label / `name` / `autocomplete` / placeholder heuristics (given-name, family-name, email, tel, url) |

Values come from the kit: `profile.firstName/lastName/email/phone/location/linkedin/github/portfolio`,
`applyDefaults` (notice period, work authorisation, salary expectation), `answers[]` (question text ↔ label
fuzzy match), `coverNote`. Unmatched answers stay in the popup with a Copy button.

## 4. Flows

1. **Pair**: options page → paste URL + token → `GET /api/ext/me` → "Connected as you@…".
2. **Open an application page**: service worker calls `apply-kit?url=` for the tab URL; badge shows ✓ (job
   matched, tailored version available), ○ (profile only), or nothing (not an ATS page).
3. **Fill**: popup → "Fill this form" → content script fills and highlights; report lists filled / skipped fields.
4. **Attach**: service worker downloads the PDF (bearer) → content script creates a `File` and sets it on the
   resume `<input type=file>` via `DataTransfer` (works on Greenhouse, Lever, Ashby, Workable uploads that
   read `input.files`; drag-zones that require a real OS dialog are reported as "attach manually").
5. **Submit**: the user. Then popup → "Mark applied" → `POST /api/ext/applied` with exactly what was used.

## 5. Testing

- Unit (node): field-map heuristics, label matching, value normalisation (`apps/extension/test/*.test.ts`).
- API contract (sandbox harness, fake DB): pair → kit by URL (exact / ATS id / unknown) → applied, CORS/preflight,
  bearer rejection (`tools/sandbox-e2e/extension-api.test.ts`).
- **Browser E2E (headless Chromium + the real extension via Playwright)**: a local server hosts four fixture
  forms (Greenhouse/Lever/Ashby/Workable clones) and a mock `/api/ext/*`; the test loads the unpacked
  extension, drives the service worker, and asserts every field value, the attached file name and that no
  submit happened (`tools/extension-e2e/run.mjs`). This is what `pnpm ext:e2e` runs; see RUNBOOK §10 for the
  manual steps against a real JobRadar instance.
