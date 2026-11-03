# extension-e2e

Generated 2026-11-02T08:51:26.220Z · headless Chromium + real unpacked extension · base http://127.0.0.1:18090

**PASS — 11/11 steps**

| # | Step | Result | ms | Detail |
|---|---|---|---|---|
| 1 | extension loads; service worker + content scripts registered | ✓ | 0 | id abilnfhgcmpnmhghjmkcgobchlhlabfk |
| 2 | unpaired → clear error from the API layer | ✓ | 237 | Not paired — open the extension options and paste your JobRadar URL + token |
| 3 | pair (options page storage) → /api/ext/me succeeds | ✓ | 20 | connected as asha@example.com |
| 4 | greenhouse: job matched, badge ✓, inventory lists the fields | ✓ | 426 | fields: firstName, lastName, email, phone, location, linkedin, coverNote, resume |
| 5 | greenhouse: fill → name/email/phone/location/cover letter/LinkedIn/answers/notice/auth, PDF attached, nothing submitted | ✓ | 179 | 11 filled, 5 skipped, 11 highlighted |
| 6 | greenhouse: second fill with "only empty" leaves edited values alone | ✓ | 49 | kept user edit |
| 7 | greenhouse: "I submitted" → POST /api/ext/applied with the artifacts used | ✓ | 46 | recorded job-1 with v-tailored |
| 8 | lever: profile-only fill (no matched job) + PDF attached + no submit | ✓ | 604 | 10 filled (lever) |
| 9 | ashby: profile-only fill (no matched job) + PDF attached + no submit | ✓ | 512 | 7 filled (ashby) |
| 10 | workable: profile-only fill (no matched job) + PDF attached + no submit | ✓ | 480 | 7 filled (workable) |
| 11 | revoked token → 401 surfaces as a pairing error, nothing filled | ✓ | 150 | bad token |
