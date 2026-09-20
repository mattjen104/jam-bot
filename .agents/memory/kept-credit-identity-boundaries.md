---
name: Kept-credit identity boundaries
description: Durable identity, scope, and background-processing rules for listener-facing music credits
---

Private Library credit surfaces are active-kept-only. Canonical album pages may render already-persisted public knowledge without Keep membership, but must never expose private queue state. Recording-scoped credits stay under their tracks and must never be promoted into album-wide personnel, even when the same person appears on many tracks. Make only canonical MusicBrainz identities clickable; text-only or approximate facts stay visibly non-clickable. Treat labels as release-edition relationships, preserving distinct editions and catalog numbers rather than attaching label text to recordings.

**Why:** Credits can deepen a listener’s own Library without implying Lore has a complete global discography or label catalogue. Public queue status would leak that a listener caused enrichment. Promoting track participation to album personnel fabricates scope; collapsing names, works, releases, or labels creates false identity and lets reissues overwrite original-release evidence.

**How to apply:** Persist all linked works and normalized role facts with parser/fetch provenance and honest partial status. Derive public status only from public persisted facts, never private queue state. Keep Apple IDs as provider references. Run reconciliation off hot paths with bounded advancing queue pages, atomic claims, and a database-global MusicBrainz rate lease.