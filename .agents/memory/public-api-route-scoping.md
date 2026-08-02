---
name: Public API route scoping
description: Prevent protected admin middleware from intercepting public Lore API paths.
---

Mount middleware with a structural authentication gate only under its intended URL prefix (for Lore, `/admin`).

**Why:** An unscoped router-level auth gate intercepts any later public route miss and responds `503 Admin entry is not configured`, disguising the real routing error and making valid newly-added public paths appear unavailable.

**How to apply:** Keep public routers mounted independently; scope the protected router at its prefix. Smoke both an intended public endpoint and an unauthenticated admin endpoint after changing route order.
