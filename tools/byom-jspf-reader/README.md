# Independent Lore JSPF reader

This dependency-free page proves that a client outside the Lore application can
consume the public BYOM/JSPF collection-page representation.

Serve the repository root with any static HTTP server, open
`tools/byom-jspf-reader/`, and provide either:

- the public collection endpoint, `/api/collections/{slug}.jspf`; or
- the `.jspf` file downloaded from Lore's public collection page.

The reader imports no Lore modules. It uses only standard JSPF fields plus the
documented `lore:identity` and `lore:unavailable` metadata. It maps every track
in array order and labels `mbid`/`isrc` entries as resolved and
`text`/`unavailable` entries as unresolved. It never filters gaps.
