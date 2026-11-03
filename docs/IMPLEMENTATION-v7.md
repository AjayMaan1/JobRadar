# JobRadar v7 — visual resume editor (implementation notes)

Implements `docs/HLD-resume-editor.md`: structured form ‖ live preview ‖ live score + inline suggestions.

| Part | What | Where |
|---|---|---|
| Client-safe core | `@jobradar/resume/client`: schema, `scoreResume` (ats-v1), `validateGrounding`, `applyProposal`, `renderAtsClassicHtml`, diff/grounding helpers — pure TS + zod, no node/Prisma, so the browser runs the same code as the worker | `packages/resume/src/client.ts`, `version/editor.ts` |
| Editor state | `apps/web/lib/resume-editor.ts`: `editPath` (JSON pointer), `applySuggestion` / LIFO `undoSuggestion`, `liveScore`, `suggestionGains` (recomputed on the current draft), `changes`, `grounding`, localStorage draft persistence | tested headless |
| UI | `/resumes/[id]/edit?job=&base=`: `EditorForm` (basics, experience cards with one-line-per-bullet, skills groups, education, projects, certificates/languages/other; inline ⚠ grounding flags), live `<iframe srcDoc>` preview (150 ms debounce), `ScoreRail` (score ring base→draft, component bars, matched/missing chips, suggestions sorted by live gain with Apply/Reject, keyword questions Yes/No, applied list with undo, Generate/Analyse) · entry points in Profile → Resumes (*Edit*) and Tailor tab (*✎ Open in editor*) | `apps/web/app/components/editor/*`, `app/resumes/[id]/edit/page.tsx` |
| Save | `POST /api/resume-versions { baseVersionId, jobId?, content, acceptedSuggestionIds?, note }` → `VersionService.createFromEditor`: schema validation, `diffContent` change log, grounding of every new/changed line vs the master + confirmed facts (flags stored in `changeLog.grounding`, never blocking), tailored version (job) or correction (becomes current; re-embeds profile), then the existing render → verify → re-score pipeline | `version.service.ts`, `api/resume-versions/route.ts` |

Tests: `editor.test.ts` (diff, grounding incl. per-line list changes, round-trips) · `resume-editor.test.ts`
(reducer, gains = actual score delta, LIFO undo, persistence) · `e2e-editor` through the real route + inline
renderer (tailored version: change log, 2 grounding flags, accepted suggestion, real PDF re-parsed contains the
edited headline + added skill, new AtsReport, Apply Kit offers it, master untouched; correction mode; validation
errors) · online `apply-flow.ts` gained a v7 step.
