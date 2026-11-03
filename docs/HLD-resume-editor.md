# HLD — Visual resume editor with live preview, live score and inline suggestions

Goal: edit a resume **inside JobRadar**, see the rendered result next to the form as you type, watch the
ATS match score move, and apply the grounded suggestions in place — instead of round-tripping through
another tool. Saves are immutable versions (HLD-apply-portal-v3 V4); nothing changes the master silently (V1);
the grounding validator still flags claims that are not in the master resume (V2).

## 1. Layout

```
┌─ /resumes/:id/edit?job=…  ──────────────────────────────────────────────────────────────────────────────────────────┐
│ header: resume label · base version · job (optional) · draft saved 12:03 · [Discard draft] [Save as version ▸]       │
├──────────────────────────────┬──────────────────────────────────┬───────────────────────────────────────────────────┤
│ EDITOR (structured form)     │ LIVE PREVIEW                     │ SCORE & SUGGESTIONS (only with a job)             │
│  Basics: name, headline,     │ <iframe srcdoc>                  │  ● 74  (base 58 → draft 74, +16)                  │
│   email, phone, links,       │ renderAtsClassicHtml(draft)      │  components: required 28/35 · preferred …          │
│   location, summary          │ — the same template the PDF      │  matched chips · missing chips                    │
│  Work: role cards, bullets   │   uses; re-rendered on every      │  ─────────────────────────────────────────────    │
│   (one line = one bullet),   │   keystroke (debounced 150 ms)    │  Suggestions (pending)                            │
│   keywords                   │                                  │   ▸ bullet_rewrite /work/0/highlights/2  +4 ▸Apply │
│  Skills groups, Education,   │ parse/format warnings of the     │   ▸ skills_section  Kafka, gRPC        +6 ▸Apply  │
│   Projects, Certificates,    │   base upload (parseability)     │   ▸ keyword_confirm "Have you used Kafka?" Yes/No │
│   Languages, Other sections  │                                  │   applied: ✓ … [Undo]                             │
│  ⚠ grounding flags next to   │                                  │  [Generate suggestions] [Regenerate]              │
│   edited text                │                                  │  grounding: 1 claim not in your master resume      │
└──────────────────────────────┴──────────────────────────────────┴───────────────────────────────────────────────────┘
```

## 2. Where the logic runs

Everything that makes the editor feel instant runs **in the browser** on the draft JSON — no server round trips:

| Concern | Function (pure, shared with the worker) | Source |
|---|---|---|
| Preview | `renderAtsClassicHtml(draft)` (same template as the PDF) | `packages/resume/src/render/template-ats-classic.ts` |
| Score | `scoreResume(draft, requirements, parseWarnings)` — ats-v1, identical to the worker | `packages/resume/src/score/ats-v1.ts` |
| Suggestion gain | `scoreResume(applyProposal(draft, s)) − scoreResume(draft)` recomputed per keystroke | `suggest/apply.ts` |
| Grounding | `validateGrounding(text, { master, confirmedFacts })` on every changed string | `ground/validate.ts` |
| Diff / change log | `diffContent(base, draft)` → `[{ path, before, after }]` | `version/editor.ts` (new) |

They are exported through a **client-safe entry** `@jobradar/resume/client` (zod + pure TS only; no Prisma,
no pdf/docx/node modules), so the web bundle stays small. The server uses the very same functions when it
persists the version, so what you saw is what gets stored and scored.

Inputs fetched once when the editor opens: the base version content, the resume's parse warnings, the
job's latest report (`requirements` + base score) and the pending suggestions, the profile's confirmed facts.

## 3. State & persistence

```
draft = base.content ──(form edits · apply/undo suggestion)──► draft' ──(debounce)──► preview · score · grounding
   │                                                                 │
   └── autosaved to localStorage (key: baseVersionId+jobId) ─────────┘   "Discard draft" → back to base

Save as version  ──► POST /api/resume-versions { baseVersionId, jobId?, content: draft, acceptedSuggestionIds, note }
                      server: ResumeContentSchema.parse · diffContent(base, draft) · validateGrounding on every
                      changed string vs the MASTER version + confirmed facts (flags stored, never blocks)
                      → ResumeVersion { kind: tailored (job) | correction (no job), parentId: base, changeLog:
                        { editor: true, changes, grounding, acceptedSuggestionIds, scoreBefore } }
                      → render queue (PDF/DOCX, verification, re-score with ats-v1) → Apply Kit picks it up
```
Applying a suggestion in the editor also marks it `accepted` on the server (existing `PATCH /api/suggestions/:id`),
undo marks it `pending` again, so the Tailor tab and the editor agree.

## 4. API (one addition)

`POST /api/resume-versions` accepts a second shape: `{ baseVersionId, jobId?, content, acceptedSuggestionIds?, note? }`.
Without `jobId` it is a **correction** of the resume (becomes its current version, profile re-seeded if master) —
the same semantics as `PATCH /api/resumes/:id { content }` but with a change log and grounding flags.

## 5. Testing

- Pure: `version/editor.test.ts` — diff, grounding of changed strings, round-trip of bullet text ↔ arrays.
- Route + pipeline (sandbox harness, fake DB, inline renderer): create an editor version with a job →
  change log + grounding flags stored → rendered (PDF/DOCX keys) → re-scored (new AtsReport) → Apply Kit
  offers it; correction mode without a job updates `currentVersionId`.
- Client logic: `apps/web/lib/resume-editor.ts` (draft reducer: edit paths, apply/undo suggestion, live score,
  gains) unit-tested with the same functions the UI calls.
- Manual UI steps in RUNBOOK §11.
