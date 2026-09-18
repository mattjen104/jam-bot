# Rocksky compatibility decision

First-pass result from the deterministic 300-item Lore sample generated on
2026-09-18.

## Decision

Use Rocksky as an optional, offline interoperability reference only. Do not add
it to Lore's live resolution path, do not make it a runtime dependency, and do
not design a public Lore lexicon around it yet.

## Sample

- 300 Lore observations, 50 from each planned stratum.
- 88 observations had no direct MBID or ISRC suitable for the first pass.
- 212 observations had at least one direct identifier.
- 295 independent lookups were made: 212 by MBID and 83 by ISRC.
- Production database writes: zero.

## Results

- 46 lookups returned a Rocksky song.
- 28 were exact identifier-and-metadata matches.
- 14 preserved the queried identifier but differed in display metadata.
- 4 ISRC lookups conflicted with Lore's MusicBrainz recording identity.
- 249 lookups returned HTTP 500.
- 37 distinct Lore observations received a usable Rocksky response.
- 34 distinct Lore observations had an exact or compatible result.

The accepted direct-reference coverage is therefore 34 of 212 eligible sample
items (16.0%). A further three items returned identity conflicts.

## Identifier behavior

### MBID

- 212 lookups
- 20 exact
- 8 compatible
- 184 HTTP 500
- No returned MBID conflicted with the queried MBID.

When Rocksky had the MBID, it was the safer lookup key in this sample.

### ISRC

- 83 lookups
- 8 exact
- 6 compatible
- 4 conflicts with Lore's MBID
- 65 HTTP 500

ISRC found useful records, but it sometimes selected a different edition or
MusicBrainz recording carrying the same ISRC. ISRC-only results must remain
claims requiring conflict checks.

## API behavior

Rocksky's current source intends a typed `NotFound` response. The deployed
`getSong` endpoint instead returned HTTP 500 for every absent identifier tested
in this run. Consequently, this study cannot distinguish a clean catalog miss
from an internal retrieval failure using the deployed status alone.

This prevents Rocksky from being a reliable request-time dependency and makes
retry policy unsafe: most retries would likely repeat definitive misses that
are mislabeled as transient failures.

## Provider links

Of the 46 successful responses:

- 40 contained Spotify links.
- None contained Apple Music links.
- None contained Tidal links.
- None contained YouTube links.

In this sample, Rocksky primarily added an AT Protocol reference and a Spotify
destination. It did not yet provide broad cross-provider availability.

## Architectural conclusions

1. Lore's existing observation, recording, and library models are sufficient.
2. Rocksky URIs can be useful external references for confirmed MBID matches.
3. Rocksky should not replace Lore's resolution evidence or MusicBrainz spine.
4. MBID matches may be accepted as references after metadata sanity checks.
5. ISRC matches must be rejected or held as candidates when their MBID conflicts
   with Lore.
6. HTTP 500 results must not be stored as definitive no-match facts.
7. No production schema change is justified by this first pass.

## Next experiment

Before considering production storage:

1. Ask Rocksky whether deployed missing-ID behavior can return a stable typed
   `NotFound`.
2. Review the four ISRC conflicts manually at release/edition level.
3. Test duplicate Rocksky records for the same MBID by querying repository
   records rather than relying only on the AppView's single selected result.
4. Run `matchSong` separately on a small unresolved/text-only sample. Keep its
   provider-search results distinct from direct identifier coverage.
5. Repeat the direct-identifier run after missing-ID behavior is fixed so
   availability and catalog-miss rates can be measured separately.

Until those questions are answered, the appropriate integration level is
"research and optional offline enrichment," not production identity plumbing.