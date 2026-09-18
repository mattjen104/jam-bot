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
data). The user's clarified wedge is *curated playlists as Nostr collections,
zappable by listeners, playable through a service-agnostic resolver (Parachord)*.
Curator tipping has NO artist-attribution problem: the recipient is the
publishing Nostr identity, whose lud16/LNURL destination is self-published.
Artist-level payment splits remain unsolved (see nostr-artist-payment-proof) and
are a separate feature. Remaining open critiques: NIP-73 has no music identifier
types (use MusicBrainz URLs in `i` tags); zero existing Nostr music clients
(Parachord plugin is the bootstrap renderer); playability is user×source, not
recording×source; personal libraries may still belong local-first while public
curation fits Nostr's public-by-default model.
