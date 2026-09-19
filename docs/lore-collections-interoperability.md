# Lore collections interoperability

Published collections are versioned as `lore.collection.v1`. The canonical
fields are kind, stable public slug, title, description, curator notes, cover
art, and an ordered entry array. Each entry explicitly declares its identity:
`mbid` (confirmed MusicBrainz recording), `isrc`, `text`, or `unavailable`.
An ISRC or text match is never promoted to an MBID.

The public JSPF projection uses standard title/creator/album/location and
identifier fields. Lore identity, confidence, and public provenance are kept
in `lore:*` metadata; JSPF consumers that discard metadata can therefore lose
identity categories, intentional unavailable gaps, and curator provenance.
Lore remains the archival authority, and uploaded JSPF provenance is treated as
untrusted round-trip metadata rather than a resolver or archival assertion.

Only verified exact Spotify track IDs/URLs are projected as links. Tokens,
signed URLs, private annotations, and resolver responses are never published.
The player capability currently reports unavailable: no stable BYOM
web-component contract has been verified, so Lore does not invent an embed.