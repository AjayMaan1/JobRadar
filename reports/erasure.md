# erasure

Generated 2026-11-02T05:14:01.198Z · 5 tests · **5 passed** · 0 failed · 0 skipped · 734 ms


## packages/resume/src/services/erasure.service.test.ts

- ✅ ErasureService › eraseUser removes profile + version vectors, the file prefix and the user row; job vectors untouched (21 ms)
- ✅ ErasureService › eraseResume only touches that resume (scoped by user) and returns null for another user (7 ms)
- ✅ ErasureService › eraseResumeVersions deletes rendered files + vectors for retention (1 ms)
- ✅ ErasureService › pruneClosedJobVectors removes vectors of long-closed jobs and of jobs whose row is gone (2 ms)
- ✅ ErasureService › sweepOrphanVectors catches vectors whose owner vanished through any path (2 ms)
