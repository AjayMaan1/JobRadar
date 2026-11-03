# JobRadar Autofill (browser extension, MV3)

Fills employer application forms with your JobRadar profile, attaches the chosen resume version (tailored if
one exists for the job, else master) and pastes drafted answers / the cover note. **You review and click
Submit** — the extension never submits anything. Design: `docs/HLD-browser-extension.md`.

No build step: plain JS, load the folder unpacked.

## Install (Chrome / Edge / Brave)
1. `chrome://extensions` → enable *Developer mode* → *Load unpacked* → select `apps/extension`.
2. In JobRadar: *Profile → Account & alerts → Browser extension → Create pairing token*.
3. Click the extension icon → *options* → paste the JobRadar URL and the token → *Save & test connection*.
   (For a JobRadar instance that is not on localhost the browser asks for permission for that origin once.)

## Use
- Open a job's *Open application ↗* link from JobRadar (or any Greenhouse / Lever / Ashby / Workable page).
  Badge: **✓** job matched + tailored resume ready · **•** job matched, master resume · **○** no matching job
  (profile-only fill).
- Popup → **Fill this form**. Filled fields are outlined green; the report lists what was skipped (copy those
  from the answers list). Untick *attach resume* if you want to upload a different file.
- After you click the employer's Submit → popup → **I submitted — mark applied** (records the exact resume
  version, answers and cover note; optional follow-up reminder).

## Files
- `src/fill-engine.js` — ATS detection, field maps, label heuristics, React-safe value setting, file attach
- `src/content.js` — runs the engine in the page on request; toast
- `src/sw.js` — token storage, JobRadar API, per-tab kit cache, badge
- `popup.html/js`, `options.html/js`

## Test
`pnpm ext:e2e` — loads this exact folder into headless Chromium (Playwright) against fixture forms and a mock
API (`tools/extension-e2e/`). `MOCK_BASE=http://localhost:3000 TOKEN=<pairing token> pnpm ext:e2e` runs the
same fill checks against a live JobRadar.
