---
name: BYOM collection boundary
description: Canonical identity, privacy, and browser-player rules for public Lore collection interoperability.
---

Lore collections remain canonical and versioned independently of their JSPF/BYOM projection. Preserve ordered unresolved and unavailable entries, MusicBrainz identity, and public radio provenance even when a consumer cannot represent every field. Provider links are optional verified projections, never canonical identity.

**Why:** No stable public BYOM Player web-component API, authorization contract, versioning policy, or licensing boundary was available when collection publishing was implemented. Inventing an embed would risk exposing provider authorization or coupling Lore to an undocumented interface.

**How to apply:** Keep browser playback behind a capability adapter that fails to explicit provider handoffs. Enable a BYOM embed only after verifying a versioned public contract, browser-local authorization, unresolved-entry behavior, and licensing. Never publish provider tokens, signed URLs, private annotations, or temporary resolver output.