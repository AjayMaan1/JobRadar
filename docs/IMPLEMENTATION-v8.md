# JobRadar v8 — UI overhaul (implementation notes)

Implements `docs/HLD-ui-v8.md`: sidebar information architecture with **For you** / **Admin**, one design
system, uncramped content pages, full-bleed workspaces, admin-only operations pages, mobile behaviour.
No API, schema or worker changes — `docs/openapi.json` is untouched and the drift test still passes.

## Route map (before → after)

| Before | After | Component |
|---|---|---|
| `/` (tabs Browse/Saved/Applied/Rejected/Closed + pipeline) | `/` Inbox (Inbox · Saved · Not interested · Closed) | `jobs/JobsWorkspace` + `JobListToolbar` + `JobRow` |
| `/` → Applied tab + `Pipeline.tsx` | `/applications` pipeline board + detail drawer | `jobs/ApplicationsPage` (uses `JobDetailPanel` in `Drawer`) |
| `/profile` (tabs Resumes / Profile / Account) | `/resumes` · `/profile` · `/account` | `profile/ResumesPage`, `ProfilePage`, `AccountPage` |
| `/preferences` | `/preferences` (restyled) | `preferences/PreferencesPage` |
| `/resumes/[id]/edit` | same, now full-bleed with Back / Discard / Save in the top bar | `editor/ResumeEditorPage` |
| `/health` | `/admin` Overview (+ redirect) | `admin/OverviewPage` |
| `/watchlist` | `/admin/companies` (+ redirect) | `admin/CompaniesPage` |
| (inside /health) | `/admin/sources` Sources & hosts | `admin/SourcesPage` (+ `SourceHealthPanel`) |
| (inside /health) | `/admin/queues` | `admin/QueuesPage` (+ `QueuesPanel`) |
| `/login` | brand panel + form | `app/login/page.tsx`, `LoginForm` |

`app/admin/layout.tsx` gates every `/admin/*` route server-side (`currentUser()` → `/login?next=` or `/`).
The sidebar shows the Admin group only for `role=admin`; it also shows the worker heartbeat pill (admins) and
the user chip / sign-out.

## Design system

- `app/globals.css`: tokens (slate neutrals, indigo accent, emerald/amber/rose semantics), component classes
  `.input` `.input-sm` `.label` `.hint` `.card` `.btn btn-{primary|secondary|ghost|danger|success} btn-{xs|sm|md}`
  `.badge` `.link` `.kbd` `.row-selected`. Base font 14 px.
- `app/components/ui/index.tsx`: `PageHeader`, `Card`, `CardHeader`, `Button`, `LinkButton`, `Badge`,
  `SegmentedControl`, `Stat`, `EmptyState`, `Field`, `Banner`, `Drawer`, `Skeleton`; `ui/Icon.tsx` inline SVGs.
- `layout/AppShell.tsx`: sidebar (drawer on mobile), sticky top bar with title / subtitle / actions, `fullBleed`.
- Every legacy `gray/blue/red/green/yellow/purple` utility was mapped onto the palette; the UI smoke run fails
  if one comes back.
- Test hooks: `data-smoke="job-row" | "job-detail" | "pipeline-card"` (stable selectors for Playwright).

## Page notes

- **Inbox**: list ‖ detail; `?job=` deep link selects; below `lg` the detail is a full-screen sheet with
  "← Back to list" (`mobileDetail` state). Keyboard hints in the list footer. Banner when evaluations are pending.
- **Applications**: board columns Applied → Interviewing → Offer → Rejected → Withdrawn, drag & drop, card click →
  `Drawer` with the full `JobDetailPanel` (apply kit included).
- **Resumes**: drop-zone upload (label optional), list rows with `Master` / status badges and xs buttons
  (Edit · Make master · Original · Re-parse · Delete), parse review with `SegmentedControl` Form/JSON, *Open
  editor* in the header and in the review toolbar.
- **Profile**: only the master profile (headline, about, titles, years, skills, apply defaults, confirmed facts);
  data export / erase moved to **Account → Your data** (the duplicate `DeleteAccount` was removed).
- **Account**: Password · Active sessions · Alerts · Browser extension · Your data (export, erase with typed
  confirmation, `btn-danger`).
- **Preferences**: sections restyled; narrow numeric inputs use `input-sm` so values are not clipped.
- **Admin Overview**: alerts banner first, then Worker / Open eligible jobs / Time to detect / Boards /
  Companies / AI / Resumes & reports / Preferences engine tiles, crawl scope, anchors without eligible
  postings, user-task queues. *Crawl now* in the top bar.
- **Editor**: `fullBleed`; grid height `calc(100vh − 5.5rem)` (top bar + padding), 2 panes (master) or 3 panes
  (job); buttons are `btn-sm` in the top bar; preview header shows template + live match.

## Removed / moved
- `app/components/jobs/Pipeline.tsx` (replaced by `ApplicationsPage`), the Profile page tabs, the old
  `/health` dashboard body (now `/admin/*`), `DeleteAccount` inside `ProfileEditor`.

## Verification

| Check | Result |
|---|---|
| `tools/typecheck-offline/run.sh` | OK (only the known "pending prisma generate" and shim-noise classes) |
| `tools/sandbox-e2e/run-all.sh` (8 stages) | ALL GREEN — migrations 30 tables/15 enums · unit 180/180 · e2e-sandbox 16 · e2e-prefs 5 · e2e-extension-api 6 · extension browser E2E 11/11 · e2e-editor 4 · **ui-smoke 19/19** |
| `reports/ui-smoke.md` + `reports/ui-smoke/*.png` | 21 screenshots: inbox (list, detail, match, tailor, apply kit), applications + drawer, resumes, editor (master + job), profile, preferences, account, admin ×4, login, mobile (list, detail sheet, nav) |

### `tools/ui-smoke/` (new)
- `build.mjs` — esbuild (from the global `tsx` install) bundles `harness.tsx`, which mounts the real page
  components by `location.pathname`; aliases `swr`, `next/navigation`, `next/link` to browser shims.
- `css.mjs` — compiles the real `apps/web/app/globals.css` with Tailwind 3.4 (found in the global toolchain)
  and the real content globs, so screenshots are pixel-faithful and purge behaviour is exercised.
- `server.ts` — seeds through the real services (ingest → evals, resume → report → suggestions, save/apply/
  reject via the real routes), then bridges `/api/*` to `apps/web/app/api/**/route.ts` (file-system routing,
  `[param]` dirs, JSON + multipart bodies, `NextResponse`/`Response` results, `next/headers` context).
- `run.mjs` — Playwright: 19 steps across all routes + interactions, console/API-failure capture, desktop and
  375 px viewports, legacy-palette guard; writes `reports/ui-smoke.{md,json}`.
- `tools/testkit/fake-prisma.ts` gained `_count: { select }` on to-many relations (used by `/api/jobs`).
- `tools/testkit/shims/next-server/{navigation.ts,link.tsx}` — SSR-side doubles (Node tests).
- `tools/sandbox-e2e/setup.sh` also links the global `react` / `react-dom`.

### Needs the online CI
`pnpm install` → `pnpm -r typecheck` → `next build` (Tailwind purge with the production pipeline, server
components, middleware, `app/admin/layout.tsx` redirect), then `tools/e2e/run-local.sh`.

## Manual checks (RUNBOOK §12)
1. Sign in as a non-admin: the sidebar has no *Admin* group; `/admin` redirects to `/`; `/health` → `/admin` → `/`.
2. Resize to < 1024 px on the Inbox: tapping a row opens the sheet; *Back to list* returns; ☰ opens the nav.
3. Applications: drag a card between columns → status persists after reload; card click opens the drawer.
4. Resumes → *Edit* → change the headline → *Save as new version* → back on `/resumes` the new version is current.
5. Account → *Erase account* stays disabled until the exact e-mail is typed.
