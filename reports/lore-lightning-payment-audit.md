# Lore Lightning payment reach audit

Generated 2026-09-18T17:40:36.808Z. Reproduce with `pnpm --filter @workspace/api-server run audit:lightning-payments`.

## Snapshot

- History: 2022-11-07 17:51:55 through 2026-09-18 17:40:43.235
- Spins: 1,876,886
- Distinct normalized artist names: 199,390
- MusicBrainz-identified artists: 41,152 (180,583 spins)
- Eligible stations examined: 271 (175 with spins)

## Results

Artists: **0 verified recipients**; 0% of canonical artists, 0% of normalized artists, and 0% of all spins. Mechanisms: {"lightning_address":0,"lnurl_pay":0,"nostr_zap":0,"other_lightning":0}.

Stations: **0 verified recipients**; 0% catalog-wide and 0% among spin-active stations. 75 eligible stations have an existing fiat-only donation route; 196 have no accepted payment evidence.

## Interpretation and limitations

This is a conservative reach audit, not a claim that recipients without a match lack Lightning. Raw artist-name-only identities are measurable but deliberately unsearchable for positive matching. Search results, social-profile names, custodial pages with unclear ownership, generic donation pages, and commercial stores are not proof. A Nostr profile alone also does not prove payment reach: NIP-57 requires an LNURL-pay endpoint derived from a `lud16` Lightning address or an event `zap` tag; zap support additionally requires the endpoint to return `allowsNostr: true` and a valid `nostrPubkey`. The reviewed evidence ledger is finite and timestamped, so coverage is a lower bound and becomes stale.

Candidate discovery crawled all 22,886 public Wavlake tracks available at 2026-09-18T17:35:06.347Z and crossmatched exact normalized artist/title plus compatible duration against canonical Lore recordings. It found 8 artist candidates: 0 verified, 6 with conflicting ownership evidence, and 2 supported by only one recording or lacking a usable Nostr recipient key. The station pass examined 277 configured official/support pages; 109 could not be fetched under the audit's HTTPS, DNS-pinning, redirect, timeout, and size controls. A public-index name match, shared recipient key, or single recording without an official/canonical backlink remained unresolved and did not enter the positive ledger. Full candidate reasons are in `research/lore-lightning-payment-candidates.json`.

## Safest integration boundary

Do not add a general payment button from these results alone. If Lore proceeds, keep a server-side, canonical-recipient registry keyed by artist MBID or station slug. Store mechanism, destination, identity evidence, provenance, verification status, and expiry separately. Revalidate Lightning-address/LNURL metadata and Nostr payment fields off the request path, never infer ownership from display names, and show the recipient plus evidence freshness before the listener confirms a handoff to their own wallet. Lore should not custody funds, create invoices, split payments, or silently choose among conflicting destinations.

## Accepted evidence

_No reviewed candidate passed every identity and destination gate._

## False-positive controls

- Artist positives require a canonical MusicBrainz artist ID present in the snapshot.
- Station positives require an exact Lore station slug present in the eligible catalog.
- Evidence and identity links must be credential-free HTTPS URLs.
- Destinations must match the declared Lightning/Nostr mechanism.
- Bandcamp, merch, generic donation pages, search snippets, and name-only matches never count.
- A Nostr npub/profile alone is identity evidence, not a payment destination; NIP-57 still requires LNURL-pay metadata via lud16 or a zap tag.
- No payment or invoice request is sent by this audit.
