---
name: Album-art fallback must be a local asset
description: Why the RUMOURS placeholder is bundled locally and how img.src comparisons must handle it
---
The universal RUMOURS placeholder previously pointed at coverartarchive.org, and that URL became a 404 (CAA has no art for that release-group id) — so every "fallback" rendered as a broken image.

**Rule:** an error-fallback image must have zero external dependencies. RUMOURS is now `${import.meta.env.BASE_URL}rumours.jpg` served from `artifacts/lore/public/rumours.jpg`.

**Why:** the fallback is by definition shown when networks/CDNs are failing; a remote fallback fails with them.

**How to apply:**
- Never point placeholder constants at remote URLs.
- `img.src` is absolutized by the browser, so equality checks against a relative constant must compare via suffix (`isShowingRumours`) or `new URL(RUMOURS, document.baseURI).href` (tests do this).
- Every album-art `<img>` should carry `onError={onArtError}` from lib/rumours; CSS background-image art can't onError, so it's excluded.
- CAA fetches need a redirect-following client and a User-Agent; direct curl of front-500 URLs may 404/fail even when art "exists" elsewhere (iTunes search API is a reliable source for canonical covers).
