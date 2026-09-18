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

Before manual adjudication, the automated classifier accepted 34 of 212
eligible sample items (16.0%) and flagged four items as identity conflicts.
The review below accepts one flagged item as a duplicate recording and rejects
three. Post-review accepted direct-reference coverage is therefore 35 of 212
eligible items (16.5%).

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

## ISRC conflict review

Reviewed against the Rocksky response captured in
`rocksky-compatibility-observations.jsonl` and the MusicBrainz recording,
ISRC, duration, artist-credit, and release evidence available on 2026-09-18.
MusicBrainz redirects were followed before comparing identities.

| ISRC | Lore recording | Rocksky recording | Classification | Evidence and conclusion |
| --- | --- | --- | --- | --- |
| `GBWWP1300169` | `e916cd85-3cf3-4e91-9f58-0f945766dd51` | `81744c97-f143-40e0-9edc-9695477f450d` | **Bad external metadata** | Lore's recording is the 307.760-second live-acoustic performance on *Acoustic at the Ryman* and carries the queried ISRC. Rocksky's title, album, and 307.760-second duration describe that same performance, but its attached MBID is a 466-second recording released on the promotional compilation *Virgin Recommends 20* and carries no ISRC. The Rocksky MBID is the bad field; it is not a different edition of the returned audio. |
| `USQX92505473` | `5e5cc08e-b4a5-43e4-a5f7-a8befec7ca25` (redirects to `a3289b2a-833a-4ee7-bc59-1abe1f946917`) | `5f31a97e-4c9a-48da-a199-9ef2dfd7adf3` | **Same recording** | Both MusicBrainz records are Slayyyter's “DANCE…”, are 287 seconds long, and appear on official 2026-01-16 releases in the same `DANCE…` release group (`0e543f7d-c990-4f60-8a02-a07eab05145d`). The canonical Lore record carries the queried ISRC; the duplicate Rocksky MBID has no ISRC. Rocksky's artist, title, album context, and 287.085-second duration agree. This is a duplicate MusicBrainz recording identity, not conflicting audio. |
| `USAT22602376` | `15c6db57-5ba5-4aa9-a769-95bb473ae1a8` | `d5e6aaf8-e8e2-4242-9b4b-6889354a448d` | **Bad external metadata** | Lore's 167-second “SS26” carries the queried ISRC. Rocksky returns matching artist/title/album and a 167.674-second duration, but the attached MusicBrainz record is a separate 168-second “SS26” carrying `USAT22603444`, not the queried ISRC. Because the returned MBID has explicit contradictory ISRC evidence, Rocksky's MBID-to-ISRC attachment cannot be accepted even though the display metadata is nearly identical. |
| `GBAHT0300074` | `ca51dca9-58e1-4a94-9ad9-fed58af17c13` | `91a03abd-5c7e-4e61-acec-9c1cfc0a7ac8` | **Bad external metadata** | Lore's recording is 230 seconds, carries the queried ISRC, and appears on the original 1984 single and album releases. Rocksky describes that original album recording at 229 seconds, but its attached MBID is a 204-second recording found on the 2017 compilation *The Many Faces of The Smiths* and carries no ISRC. The returned MBID does not describe the returned Rocksky audio. |

None of the four is best classified as a different edition or bad ISRC reuse.
The Slayyyter case is a duplicate recording entry for the same audio. In the
other three, the queried ISRC remains consistent with Lore; the conflict is the
MBID attached to the Rocksky record.

## Acceptance rule for ISRC-only references

An ISRC-only Rocksky result may be stored as a confirmed external reference
under the following rule.

### Common prerequisites

1. Normalize the ISRC to uppercase without punctuation. The Rocksky result must
   return exactly the queried ISRC.
2. Resolve Lore's MBID and any Rocksky MBID through current MusicBrainz
   redirects before comparing them.
3. MusicBrainz must show the queried ISRC on Lore's canonical recording. If it
   does not, hold the result as a candidate for manual review.
4. Artist and title must agree after conservative normalization. When both
   sides provide duration, the difference must be no more than two seconds.

If any prerequisite fails, hold the result for manual review.

### MBID branches

- **Rocksky has no MBID:** Accept only as an ISRC-scoped external reference. It
  must not create or replace a recording identity.
- **Canonical MBIDs are equal:** Accept the external reference.
- **Canonical MBIDs differ:** Accept only when MusicBrainz demonstrates an
  exact duplicate recording: same artist and title, duration within two
  seconds, and at least one shared release-group MBID. The Rocksky MBID must
  not carry an ISRC different from the queried ISRC. Store the reference
  against Lore's canonical recording; never replace Lore's MBID with the
  duplicate.
- **Differing MBIDs do not meet the duplicate test:** Reject the automatic
  link. A contradictory ISRC, materially different duration, different
  artist/title, or release evidence for a different performance is sufficient
  to reject it. Metadata agreement in the Rocksky payload does not override
  contradictory MusicBrainz evidence.

Failures remain reviewable candidates with their evidence attached. They are
not negative catalog facts and must not mutate Lore's recording spine.

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
5. ISRC matches with a different MBID must be rejected or held unless the
   recording-level duplicate test above passes; accepted duplicates remain
   attached to Lore's canonical MBID.
6. HTTP 500 results must not be stored as definitive no-match facts.
7. No production schema change is justified by this first pass.

## Next experiment

Before considering production storage:

1. Ask Rocksky whether deployed missing-ID behavior can return a stable typed
   `NotFound`.
2. Test duplicate Rocksky records for the same MBID by querying repository
   records rather than relying only on the AppView's single selected result.
3. Run `matchSong` separately on a small unresolved/text-only sample. Keep its
   provider-search results distinct from direct identifier coverage.
4. Repeat the direct-identifier run after missing-ID behavior is fixed so
   availability and catalog-miss rates can be measured separately.

Until those questions are answered, the appropriate integration level is
"research and optional offline enrichment," not production identity plumbing.

## `matchSong` pilot

A separate candidate-only pilot ran on 2026-09-18. It used 20 deterministic
manifest rows: the first 10 complete artist/title rows from the independently
resolved `text` stratum and the first 10 from the `unresolved` stratum. This
pilot made no production database writes and did not change a live resolver.

Every `matchSong` response was recorded as `candidate_only`, including responses
whose returned MBID agreed with Lore. Provider-search results were not added to
the direct-identifier coverage above.

### Results

- 20 requests: 10 resolved controls and 10 unresolved observations.
- 12 returned HTTP 200 candidates; 8 returned HTTP 500.
- 2 of the 6 returned controls were independently confirmed by both Lore MBID
  and normalized artist/title.
- 3 of the 6 returned controls had a different MBID from Lore despite matching
  artist/title text. This is a known false-positive/edition-conflict rate of
  50% among returned controls (3 of 6), or 30% across all requested controls
  (3 of 10).
- The remaining returned control matched text but supplied no MBID, so it could
  not be independently confirmed.
- 6 unresolved observations returned candidates. One was a clear false
  positive on manual review: `Who — You Better You Bet` returned Bette Midler's
  `The Folks Who Live On The Hill`.
- The other 5 unresolved candidates are not counted as identified. Three had
  exact normalized text and two had plausible featured-artist formatting
  differences, but none had independent evidence in this pilot.

### Edition ambiguity

Seven of 12 returned candidates (58%) exposed multiple exact-text provider
matches that differed by ISRC, album, or duration. Four of those seven were in
the resolved control stratum. Exact artist/title text therefore did not select
a recording or release edition safely.

### Latency and availability

- Mean latency: 2,458 ms.
- Median latency: 2,004 ms.
- p95 latency: 5,000 ms.
- Maximum latency: 6,444 ms.
- 8 of 20 requests (40%) returned HTTP 500 rather than a typed no-match.

This remains unsuitable for request-time resolution independently of match
quality.

### Provider links

All 12 successful responses supplied at least one provider link. There were 72
links in total because `matchSong` includes a ranked Deezer search-result list
in addition to any link on the selected Rocksky song. Link volume is not
identity confidence: ambiguous and false-positive responses also carried links.

### Conclusion

`matchSong` cannot safely identify unresolved Lore spins. It is useful only as
an offline candidate generator for later independent confirmation. A candidate
must not create or change a recording identity, and matching text, search
score, provider links, or a returned MBID are insufficient confirmation on
their own. The direct-identifier decision is unchanged: Rocksky remains an
optional research reference, not production identity plumbing.

Pilot evidence is preserved separately in
`research/rocksky-match-song-observations.jsonl` and
`research/rocksky-match-song-summary.json`.