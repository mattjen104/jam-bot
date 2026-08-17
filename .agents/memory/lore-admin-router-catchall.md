---
name: Lore admin router catch-all
description: Admin router in lore/index.ts has a blanket rate-limit + auth middleware that intercepts all unmatched paths — new API routers must be mounted before loreRouter.
---

# Lore admin router catch-all

## Rule
Any new router serving `/api/*` paths must be mounted **before** `loreRouter` in `artifacts/api-server/src/routes/index.ts`. If mounted after, the admin router's blanket middleware intercepts all unmatched paths and returns 503 "Admin entry is not configured" before the new router can handle the request.

**Why:** `artifacts/api-server/src/routes/lore/admin.ts` registers `router.use(rateLimit(...))` and `router.use(authMiddleware)` without a path prefix. These run for every request that falls through the stationsRouter, recordingsRouter, pickersRouter, and archiveRouter — i.e., any path the lore sub-routers don't recognise. The admin route handlers themselves are path-prefixed (`/admin/*`), but the middleware is not.

**How to apply:** In `routes/index.ts`, the order must be:
```
router.use(healthRouter);
router.use(songRouter);
router.use(meRouter);      // ← any new router: before loreRouter
router.use(loreRouter);    // ← loreRouter last; admin catch-all lives inside here
router.use(spotifyRouter);
router.use(shareRouter);
```

## Corollary: pre-loreRouter routes lose the catch-all's protections

Mounting before `loreRouter` means the route is also outside its blanket rate-limit/auth middleware. A **public** route mounted there must carry its own per-IP `express-rate-limit` guard (trust proxy is set in app.ts) — the completion code review rejects unauthenticated proxy/fan-out routes without one. If the route calls an upstream API, also add a short single-flight cache (never cache failures) so bursts collapse into one upstream fetch. Pattern: `artifacts/api-server/src/routes/station-search.ts`; test the 429 via a factory-built low-limit limiter while the default instance skips under VITEST (same pattern as the ACR fingerprint limiter).
