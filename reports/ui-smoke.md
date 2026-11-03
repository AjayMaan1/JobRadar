# ui-smoke

Generated 2026-11-02T08:51:58.303Z · 19 steps · **19 passed** · 0 failed

Real page components (esbuild) + real API route handlers (bridged) + real Tailwind CSS (3.4.18) in headless Chromium against a seeded in-memory DB.

| # | step | result | detail |
|---|---|---|---|
| 1 | inbox (/) mounts with sidebar IA, list + detail, tier chips | ✅ | 5 rows · nav: Inbox / Applications / Resumes / Profile / Preferences / Account / Overview / Companies / Sources & hosts / Queues |
| 2 | inbox: selecting a row opens the detail; ?job= deep-link selects it | ✅ | "Senior Backend Engineer (Remote - EMEA)" |
| 3 | inbox: Match / Tailor / Apply tabs show the stored report, pending suggestions and the apply kit | ✅ | 4 pending suggestion action(s) |
| 4 | inbox: tabs Saved / Not interested / Closed filter through the real API | ✅ | saved 1 · not interested 1 · closed 1 |
| 5 | inbox: search box filters the list (FTS through the real route) | ✅ | 5 rows for "Kubernetes" |
| 6 | applications (/applications): pipeline board with the applied job; card opens the drawer | ✅ | 1 card(s) |
| 7 | resumes (/resumes): upload card, list with Master badge + status, parse review with warnings | ✅ | 3 editor links |
| 8 | editor (/resumes/:id/edit): full-bleed 2-pane; a headline edit updates the live preview + change count | ✅ |  |
| 9 | editor with a job (/resumes/:id/edit?job=&base=): 3-pane with score rail + suggestions; Apply updates the live score | ✅ | 3 applicable suggestion(s) |
| 10 | profile (/profile): master profile form is populated from the seed | ✅ |  |
| 11 | preferences (/preferences): document loads (home country, tiers, pay floor) and the wizard/sections render | ✅ |  |
| 12 | account (/account): password, sessions, alerts, extension, data cards | ✅ |  |
| 13 | admin overview (/admin): stats, worker pill, problem boards; health feeds the sidebar pill | ✅ |  |
| 14 | admin companies (/admin/companies): table with the 3 seeded companies + boards; /watchlist redirects here | ✅ |  |
| 15 | admin sources (/admin/sources): host policies + aggregator sources | ✅ |  |
| 16 | admin queues (/admin/queues): inline mode shown, no failed jobs | ✅ |  |
| 17 | login (/login): brand panel + form with email/password | ✅ |  |
| 18 | mobile (375px): sidebar collapses behind the menu button; inbox list is single-column | ✅ |  |
| 19 | no stray legacy palette classes in the bundle (gray-*/blue-*/red-* → slate/indigo/rose) | ✅ |  |

## Screenshots

- [01-inbox](ui-smoke/01-inbox.png)
- [02-inbox-detail](ui-smoke/02-inbox-detail.png)
- [03-inbox-match](ui-smoke/03-inbox-match.png)
- [04-inbox-tailor](ui-smoke/04-inbox-tailor.png)
- [05-inbox-applykit](ui-smoke/05-inbox-applykit.png)
- [06-applications](ui-smoke/06-applications.png)
- [07-applications-drawer](ui-smoke/07-applications-drawer.png)
- [08-resumes](ui-smoke/08-resumes.png)
- [09-editor](ui-smoke/09-editor.png)
- [10-editor-job](ui-smoke/10-editor-job.png)
- [11-profile](ui-smoke/11-profile.png)
- [12-preferences](ui-smoke/12-preferences.png)
- [13-account](ui-smoke/13-account.png)
- [14-admin-overview](ui-smoke/14-admin-overview.png)
- [15-admin-companies](ui-smoke/15-admin-companies.png)
- [16-admin-sources](ui-smoke/16-admin-sources.png)
- [17-admin-queues](ui-smoke/17-admin-queues.png)
- [18-login](ui-smoke/18-login.png)
- [19-inbox-mobile](ui-smoke/19-inbox-mobile.png)
- [20-inbox-mobile-detail](ui-smoke/20-inbox-mobile-detail.png)
- [21-inbox-mobile-nav](ui-smoke/21-inbox-mobile-nav.png)
