---
name: Import job polling invalidation
description: Latest-import-job query stops polling on terminal states; every start-import trigger must invalidate it.
---

`useLatestImportJob` deliberately returns `refetchInterval: false` once the cached job is `done`/`error` (or null). That means the cache freezes on the old terminal job.

**Why:** clicking "Retry import" started a real server job but the UI kept showing "Last import failed — retry to try again" forever, because nothing woke the query up.

**How to apply:** every call site of `postStartImport` must `invalidateQueries(ME_LATEST_IMPORT_JOB_KEY)` in a `finally` (success AND failure — a 409 "already running" also needs a re-sync). If more trigger points are added, prefer a shared start-import helper that does the invalidation itself.
