---
name: Lore resolution ordering & cursor-driven ingestion
description: resolveToMbid identifier priority + convergence rule, and history poller must page back to the cursor.
---

# Lore spin resolution & ingestion invariants

## Identifier priority + convergence
`resolveToMbid` must try identifiers strongest-first: recording_id > isrc > text
search > unresolved. A cached result must NEVER short-circuit a stronger
identifier a later spin carries.

**Why:** a first spin seen only as artist+title can cache an `unresolved` miss.
If the text cache is consulted before ISRC, a later spin *with* an ISRC would
return that stale unresolved and never converge. That breaks the stated tier
priority and the "unresolved spins can resolve later" requirement.

**How to apply:** cache each identifier under its OWN key namespace — ISRC under
`isrc\u001f<isrc>`, text under the normalized artist+title key. Try ISRC (its own
cache, hit or live) before the text cache; only fall through to text on an ISRC
miss. recording_id is free (no network) so it returns before any cache. Still
cache hits AND misses per namespace to honor MusicBrainz 1 req/sec.

## Cursor-driven history ingestion
History pollers must be truly cursor-driven, not "fetch latest N and dedup."

**Why:** fetching a fixed window (e.g. latest 20) and deduping against seen
externalIds silently DROPS plays whenever more than one window's worth arrived
since the last poll (downtime, slow cadence). The persisted `lastSeenCursor` is
useless if it only sizes the initial backfill.

**How to apply:** page newest-first (adapters take a `page`/offset opt — KEXP
`offset`, Spinitron 1-based `page`; BBC "latest" has no history so it pages once)
and keep walking pages until the batch contains the last-seen cursor externalId,
a page runs short, or a catch-up cap is hit. `ingestRawSpins` dedups the overlap,
so a generous page size costs no extra MusicBrainz calls (only genuinely-new
externalIds get resolved).

## Resolver failure semantics

A definitive provider miss may be cached as `unresolved`; a network, rate-limit,
timeout, or provider failure must be cached as `deferred`. Live ingestion and
historical convergence must use the same bounded query variants, including at
most one artist/title reversal after a clear direct miss.

**Why:** Treating a temporary MusicBrainz outage as a permanent miss poisons the
normalized pair indefinitely. Letting live and historical resolution diverge
also strands older reversed-field ICY spins even though a later live occurrence
would resolve.

**How to apply:** Preserve provider outcome status through every resolver layer.
Retry `deferred` rows on a paced schedule, never swap after a provider failure or
duration-only rejection, and cap a clear-miss reversal at one additional query.
