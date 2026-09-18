---
name: Portable library protocol direction
description: User-endorsed architectural separation for any future Nostr/ATProto music library work.
---

For any future portable-library (Nostr/ATProto) work, the endorsed separation is:
library = identity + relationships + preferences; resolver = "where can I play
this right now"; source = "where the music actually lives". Store source
*identifiers* (MBID, Spotify ID, Bandcamp URL), never resolution results.
Canonical record is keyed on the recording, with artist/album first-class.

**Why:** The user reviewed and endorsed an external architecture doc making this
case; it matches Lore's existing MBID recording spine and the Rocksky finding
that resolution results expire and must never be cached as facts.

**How to apply:** The schema must keep an unresolved-identity tier as
first-class (many spins never get MBIDs; see the Rocksky matchSong false-positive
data). Critiques raised and still open: NIP-73 has no music identifier types;
Rocksky interop beats minting a fresh lexicon; Nostr↔ATProto mirroring is not a
cheap translation (delete/update semantics differ); playability is user×source,
not recording×source; public Nostr collections conflict with Lore's local-first
privacy posture; Lightning routing is an attribution-evidence problem, not a
protocol problem.
