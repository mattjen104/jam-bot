---
name: Listener speech advisory boundary
description: Privacy and freshness rules for listener-facing speech evidence.
---

Listener surfaces may receive only a generic, low-confidence talk or music-resumption state with bounded evidence and expiry timestamps. Never expose transcripts, extracted claims, inferred presenter identity, classifier internals, or predicted track identity.

**Why:** Speech processing is operational evidence, not confirmed now-playing identity. A useful hint must not turn private capture data or a timing prediction into a listener-facing fact.

**How to apply:** Derive the state server-side from append-only evidence, suppress it when fresher track metadata contradicts it, expire it against the server clock, and keep indexed ledger reads off unbounded listener hot paths.