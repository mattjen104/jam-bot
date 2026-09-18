---
name: Nostr artist payment proof
description: Evidence rules for deciding whether a Nostr-linked artist can receive Lightning payments.
---

A Nostr identity alone is not payment evidence. Count a recipient only when an identity-grounded Lightning address or LNURL-pay route is present; true NIP-57 zap support also requires the endpoint to advertise Nostr support and a valid Nostr pubkey. Reject a recipient key shared across unrelated artist identities as unclear ownership.

**Why:** Public music catalogs can attach the same Nostr key to multiple famous artists or expose uploads without a recipient key. Treating the profile or catalog name as proof would direct listeners toward an unverified account.

**How to apply:** Keep Nostr-only, single-recording, shared-key, and name-only matches in the unresolved candidate ledger. Promote only canonical or official identity evidence with a validated payment route and timestamped provenance.