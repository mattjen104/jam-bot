---
name: Kept-credit identity boundaries
description: Durable identity, scope, and background-processing rules for listener-facing music credits
---

Private Library credit surfaces are active-kept-only. Public album collections may project credits for their canonical recording and release-group MBIDs, but must never consult Keep membership or the Keep-driven enrichment queue. Make only canonical MusicBrainz identities clickable; text-only or approximate facts stay visibly non-clickable. Treat labels as release-edition relationships, preserving distinct editions and catalog numbers rather than attaching label text to recordings.

**Why:** Credits can deepen a listener’s own Library without implying Lore has a complete global discography or label catalogue. Public queue status would leak that a listener caused enrichment. Collapsing names, works, releases, or labels creates false identity and lets reissues overwrite original-release evidence.

**How to apply:** Persist all linked works and normalized role facts with parser/fetch provenance and honest partial status. Derive public status only from public persisted facts, never private queue state. Keep Apple IDs as provider references. Run reconciliation off hot paths with bounded advancing queue pages, atomic claims, and a database-global MusicBrainz rate lease.