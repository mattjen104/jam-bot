---
name: Fast Refresh mixed exports → phantom context crash
description: Why exporting constants/helpers from React component files causes "must be used within a Provider" crashes during HMR, and the boundary rule to prevent it.
---

**Rule:** Component files (.tsx rendering components) must export *only* React components. Constants, pure helpers, and hooks-adjacent utilities live in `lib/*` modules.

**Why:** Vite React Fast Refresh can't hot-swap a module that mixes component and non-component exports ("export is incompatible" / "new export" invalidate). The invalidation cascade can re-instantiate a context provider module while mounted consumers still hold the old one — two `?t=` timestamps of the same module → two distinct Context objects → a consumer correctly nested inside the provider still crashes with "useX must be used within a XProvider". The crash looks like a tree-structure bug but App.tsx is fine; check the stack's module timestamps.

**How to apply:** When adding exports to a component file for testability (pure formatting/grouping helpers), put them in a `lib/` module instead and import them. If the crash appears anyway during dev, a full restart/reload of the dev server clears the split-module state — but fix the export boundary or it recurs on every HMR touch.
