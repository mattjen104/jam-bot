---
name: Stale tsx dev server after new routes
description: A running api-server workflow can serve pre-fix code and return misleading 503 errors from the admin catch-all instead of a new route's real handler.
---

When new Express routes are added to `artifacts/api-server` (e.g. new `/insights` endpoints under the lore router), a long-running `tsx` dev server occasionally keeps serving a stale route table and the request falls through to the admin router's catch-all, returning `503 {"error":"Admin entry is not configured"}`.

This looks exactly like the known "admin catch-all shadows new /api/* routes" bug (see lore-admin-router-catchall.md), but is actually just dev-server staleness.

**Why:** wasted time chasing router-ordering bugs when the actual routes were already correctly ordered/mounted in source.

**How to apply:** before deep-diving into router ordering/middleware when a brand-new route 503s with "Admin entry is not configured", first restart the `artifacts/api-server: API Server` workflow and retry. Only investigate ordering if the 503 persists after a clean restart.
