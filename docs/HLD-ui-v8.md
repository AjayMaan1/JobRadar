# HLD — UI v8: information architecture, shell and design system

Goal: a calm, modern product surface where the **candidate** never meets crawler internals and the **admin**
has one clear place for operations. Every page gets room to breathe: one primary task per screen, consistent
spacing, one accent colour, no 10 px text walls.

## 1. Information architecture

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ☰  JobRadar                         ┌─ top bar: page title · page actions · user chip ──────────────────┐│
│ ─────────────────────                │                                                                   ││
│  FOR YOU                             │  /                Inbox        ── list ‖ detail (full-bleed)       ││
│   ▸ Inbox            /               │  /applications    Applications ── pipeline board + detail drawer   ││
│   ▸ Applications     /applications   │  /resumes         Resumes      ── upload · list · parse review     ││
│   ▸ Resumes          /resumes        │       /resumes/:id/edit  Editor (form ‖ preview ‖ score rail)      ││
│   ▸ Profile          /profile        │  /profile         Master profile (headline, about, skills, targets)││
│   ▸ Preferences      /preferences    │  /preferences     Match tiers · home · pay · companies · presets   ││
│   ▸ Account          /account        │  /account         Password · sessions · alerts · extension · data  ││
│                                      │                                                                   ││
│  ADMIN  (role = admin only)          │  /admin           Overview  ── alerts · worker · tiles · engine    ││
│   ▸ Overview         /admin          │  /admin/companies Companies ── watchlist, tiers, anchors, add      ││
│   ▸ Companies        /admin/companies│  /admin/sources   Sources & hosts ── adapters, boards, circuits    ││
│   ▸ Sources & hosts  /admin/sources  │  /admin/queues    Queues ── depth, failures, retry / clean         ││
│   ▸ Queues           /admin/queues   │  (old /health, /watchlist → redirect)                             ││
│ ─────────────────────                │                                                                   ││
│  ● worker alive  (admin)             │                                                                   ││
│  you@example.com  · Sign out         └───────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- The **sidebar** is the only global navigation; it collapses to icons below 1100 px and to a drawer on
  mobile. Admin items render only for `role=admin`; `/admin/*` is additionally gated server-side in
  `app/admin/layout.tsx` (`currentUser()` → redirect to `/`).
- **Candidate pages** never show crawler state (sources, boards, circuits, queues). The only ops signal a
  candidate can see is the generic "background worker is down" banner on the Inbox (because it explains why
  nothing new arrives).
- Old routes redirect: `/health → /admin`, `/watchlist → /admin/companies`; the Profile page's tabs became
  pages (`/resumes`, `/profile`, `/account`).

## 2. Design system (`app/components/ui`)

| Primitive | Purpose |
|---|---|
| `PageHeader` | eyebrow (section), title, description, right-aligned actions — every page starts with it |
| `Card`, `CardHeader` | the only container; `rounded-2xl`, hairline border, no drop shadows except floating panels |
| `Button` (`primary`, `secondary`, `ghost`, `danger`, sizes) | one button vocabulary, consistent focus ring |
| `Badge` (`tone`) | status/tier chips |
| `SegmentedControl` | tabs inside a page (Inbox / Saved / …) |
| `Stat` | metric tile (label, value, hint, tone) |
| `EmptyState` | icon + title + body + primary action, used instead of "No data" |
| `Field` + `.input` classes | form controls with the same height, radius and focus ring |
| `Icon` | inline SVG set (no icon library) |
| `Drawer` | right-hand slide-over for detail on the Applications board |

Tokens (`globals.css`): neutral `slate`, accent `indigo-600`, success `emerald`, warning `amber`, danger `rose`;
base font 14 px (`text-sm`) for body, 12 px only for metadata; spacing rhythm 4/8/12/16/24; page container
`max-w-6xl` for content pages, full-bleed for workspaces (Inbox, Editor).

## 3. Page-level decisions

- **Inbox**: list (420 px) ‖ detail. Toolbar = search + segmented tabs (Inbox · Saved · Rejected · Closed) + tier
  chips + sort; "Applications" is its own page, not a tab. Rows: title, company, tier badge, fit/ATS/score
  pills aligned in a grid. Keyboard hints move into a footer hint line.
- **Applications**: full-width pipeline board (Applied → Interviewing → Offer → Rejected → Withdrawn) with drag
  & drop; clicking a card opens the job detail in a drawer (same `JobDetailPanel`, apply kit included);
  follow-up dates visible on cards.
- **Resumes**: upload card, list with status badges and the *Edit* CTA, parse review on selection.
- **Profile / Account / Preferences**: single-column content pages, cards per concern, no nested tabs.
- **Admin**: sub-navigation inside `/admin/*` is the sidebar itself; Overview = alerts first, then worker /
  corpus / AI / preferences-engine stat tiles; Companies = watchlist table; Sources & hosts = adapter health,
  host policies with circuit state, problem boards; Queues = depth + dead letters.

## 4. Mobile behaviour
- Sidebar → drawer behind the ☰ button (`AppShell`).
- Inbox below `lg`: the list takes the full width; tapping a row (or a `?job=` deep link) opens the detail as a
  full-screen sheet with a "← Back to list" header. Above `lg` the two-pane layout is unchanged.
- Applications board scrolls horizontally; content pages are single-column already.
- The editor stays desktop-only (three panes); it is reachable on mobile but not optimised.

## 5. Not in scope
Dark mode (tokens are ready), a mobile layout for the editor.

## 6. Verification strategy (offline-capable)
`next build` needs the pnpm install; to still see the real UI in this sandbox, `tools/ui-smoke/` bundles the
**real page components** with esbuild, compiles the **real `globals.css` with Tailwind 3.4** (same config), and
bridges `/api/*` to the **real route handlers** (`apps/web/app/api/**/route.ts`, file-system routing incl.
`[id]` params, JSON/multipart bodies) over a seeded in-memory DB — then drives every route in headless
Chromium (Playwright), asserts data + interactions, collects console errors / failed API calls, and stores
screenshots under `reports/ui-smoke/`. It is stage 8 of `tools/sandbox-e2e/run-all.sh`.
Not covered: server components / middleware / the Next router itself (`tools/e2e/run-local.sh` online).
