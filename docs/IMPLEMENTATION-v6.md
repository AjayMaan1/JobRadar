# JobRadar v6 — browser autofill extension (implementation notes)

Implements `docs/HLD-browser-extension.md` (C12, tier B of the apply design): the extension fills, the user submits.

| Part | What | Where |
|---|---|---|
| Pairing | `POST/GET/DELETE /api/ext/pair` (cookie session): 180-day bearer tokens (`auth_tokens.kind=extension`, ≤5 live), shown once, revocable; UI card in Profile → Account | `apps/web/app/api/ext/pair`, `AccountSettings.tsx` |
| Extension API | bearer-only, CORS for `chrome-extension://` / `moz-extension://` (+ `EXTENSION_ORIGINS`), preflights; `GET /api/ext/me`, `GET /api/ext/apply-kit?url=`, `POST /api/ext/applied`; `/api/files` accepts the bearer and sends CORS headers | `apps/web/lib/ext.ts`, `apps/web/app/api/ext/*`, `api/files` |
| Kit resolution | `ExtKitService`: job by normalised URL → ATS job id (Greenhouse numeric, Lever/Ashby uuid, Workable shortcode, SmartRecruiters id) → none (profile-only); profile basics from the resume content + profile apply defaults; tailored version preferred; accepted answers + cover note from the latest report; existing application | `packages/resume/src/apply/ext-kit.ts` |
| Extension (MV3, no build) | `fill-engine.js` (ATS detection, per-ATS selectors, label/placeholder/aria heuristics, React-safe setters, `<select>` matching, `DataTransfer` file attach, answer↔question fuzzy match, cover-note pass ordering, highlight, never submits), `content.js`, `sw.js` (storage, API, per-tab kit cache, badge ✓/•/○, injects content script on demand), popup (job match, fill/only-empty/attach, report, answers with Copy, mark applied + follow-up), options (URL + token, optional host permission, connection test) | `apps/extension/` |
| Tests | API contract on the fake DB (6 steps: pair, bearer/CORS, URL/ATS-id/none resolution, bearer file download, applied, revoke); **browser E2E with the real unpacked extension in headless Chromium** (11 steps across 4 ATS fixtures: values, attached PDF, skipped report, only-empty, mark applied, 401 handling); OpenAPI drift test extended to OPTIONS | `tools/sandbox-e2e/extension-api.test.ts`, `tools/extension-e2e/` |

Results (offline sandbox): API contract **6/6**, browser E2E **11/11**, unit 173/173, sandbox e2e 16/16,
prefs e2e 5/5, typecheck OK. CI now installs Chromium and runs the browser E2E.

Known limits: drag-and-drop-only upload zones (no `<input type=file>`) are reported as "attach manually";
Workday is out of scope (account creation, iframes); Firefox needs `browser.*` polyfill (APIs used are
MV3-compatible).
