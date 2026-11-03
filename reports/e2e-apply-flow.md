# E2E — apply from the portal

Generated 2026-11-01T12:04:33.741Z · target http://localhost:3999 · LLM_PROVIDER=none · EMBEDDING_PROVIDER=none · QUEUE_MODE=inline

**Result: PASS — 24/24 steps**

| # | Step | Result | ms | Detail |
|---|---|---|---|---|
| 1 | seed a job posting (DB) | ✓ | 170 | job aa1d5d4c-0958-4ac4-8246-398ccfe1b337 |
| 2 | sign in | ✓ | 388 | verify@jobradar.local (admin) |
| 3 | unauthenticated request is rejected | ✓ | 48 | 401 without cookie |
| 4 | upload resume (PDF) | ✓ | 1042 | resume c593d287-6be8-4f05-900a-b00423de27df · status needs_review · 1 warning(s) |
| 5 | parsed resume is structured (review screen data) | ✓ | 69 | 2 roles, 8 skills, raw text 889 chars |
| 6 | edit resume (user correction → new immutable version) | ✓ | 201 | version 690823fb-09a5-4984-a2ca-b350ee23812b (correction); original parse kept |
| 7 | profile seeded from master resume | ✓ | 39 | headline "Senior Software Engineer" · 18 skills |
| 8 | analyse match (ats-v1) | ✓ | 941 | score 81 · matched 13 · missing required 5 |
| 9 | latest report is available for the job | ✓ | 53 | report e0890f7a-db7c-43e5-94dd-6ad9931fdf17 |
| 10 | generate suggestions (grounded) | ✓ | 887 | keyword_confirm×5, skills_section×1, formatting×1 |
| 11 | accept a suggestion; reject one; edit one (re-validated) | ✓ | 120 | accepted skills_section |
| 12 | fabrication guard: an edit adding an unsupported claim is flagged | ✓ | 262 | flagged: Rust, GCP, Google Cloud Certified Architect, REST APIs, Amazon EKS, Google Cloud Certified Architect |
| 13 | confirm a missing-skill question (yes + context → confirmed fact + follow-ups) | ✓ | 1380 | Observability confirmed · 1 follow-up suggestion(s) |
| 14 | opt-in headline variants are OFF unless requested | ✓ | 102 | no headline/about variants exist |
| 15 | generate tailored version + render PDF/DOCX (verified, re-scored) | ✓ | 1236 | 2 change(s) · score 81 → 86 · renderer simple · warnings none |
| 16 | download rendered PDF and DOCX via signed links | ✓ | 235 | pdf 2985 bytes · docx 10480 bytes |
| 17 | tailored version shows the master text unchanged on the profile | ✓ | 59 | master headline still "Senior Software Engineer" |
| 18 | apply kit lists the tailored version, files and copy texts | ✓ | 194 | ats greenhouse · headline "Senior Backend Engineer · Go, Kubernetes, Kafka" |
| 19 | draft application answers | ✓ | 1153 | 0 drafted answer(s) (no LLM → profile-based only) |
| 20 | mark applied with the exact artifacts sent | ✓ | 129 | application applied · version 286edfa7 · headline recorded |
| 21 | applied tab + pipeline status change | ✓ | 202 | in Applied tab, hidden from inbox, moved to Interviewing |
| 22 | search fallback: role synonyms expand the query | ✓ | 111 | "software engineer" → +9 terms, found the job (hybrid=false) |
| 23 | health (admin) reports mode and AI availability | ✓ | 166 | ollama reachable=false · queues 5 |
| 24 | cleanup (delete resume → versions/reports/files cascade; delete job) | ✓ | 108 | resume deleted=1, job deleted, cascade verified |
