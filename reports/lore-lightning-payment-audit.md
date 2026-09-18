# Lore Lightning payment reach audit

Generated 2026-09-18T18:00:54.880Z. Reproduce with `pnpm --filter @workspace/api-server run audit:lightning-payments`.

## Snapshot

- History: 2022-11-07 17:51:55 through 2026-09-18 17:51:55.009
- Spins: 1,877,039
- Distinct normalized artist names: 199,398
- MusicBrainz-identified artists: 41,168 (180,793 spins)
- Eligible stations examined: 270 (175 with spins)

## Results

Artists: **0 verified recipients**; 0% of canonical artists, 0% of normalized artists, and 0% of all spins. Mechanisms: {"lightning_address":0,"lnurl_pay":0,"nostr_zap":0,"other_lightning":0}.

Stations: **0 verified recipients**; 0% catalog-wide and 0% among spin-active stations. 74 eligible stations have an existing fiat-only donation route; 196 have no accepted payment evidence.

## Interpretation and limitations

This is a conservative reach audit, not a claim that recipients without a match lack Lightning. Raw artist-name-only identities are measurable but deliberately unsearchable for positive matching. Search results, social-profile names, custodial pages with unclear ownership, generic donation pages, and commercial stores are not proof. A Nostr profile alone also does not prove payment reach: NIP-57 requires an LNURL-pay endpoint derived from a `lud16` Lightning address or an event `zap` tag; zap support additionally requires the endpoint to return `allowsNostr: true` and a valid `nostrPubkey`. The reviewed evidence ledger is finite and timestamped, so coverage is a lower bound and becomes stale.

Candidate discovery crawled all 22,886 public Wavlake tracks available at 2026-09-18T17:35:06.347Z and crossmatched exact normalized artist/title plus compatible duration against canonical Lore recordings. It found 8 artist candidates: 0 verified, 6 with conflicting ownership evidence, and 2 supported by only one recording or lacking a usable Nostr recipient key. The station pass examined 277 configured official/support pages; 109 could not be fetched under the audit's HTTPS, DNS-pinning, redirect, timeout, and size controls. A public-index name match, shared recipient key, or single recording without an official/canonical backlink remained unresolved and did not enter the positive ledger. Full candidate reasons are in `research/lore-lightning-payment-candidates.json`.

## Deterministic top-artist review

The audit reviewed the top 25 canonical artists by spin count, with artist MBID ascending as the stable tie-breaker. 25 rows have matching timestamped reviews; 0 produced a verified destination and 25 remain unresolved. MusicBrainz URL relations, linked official sites, Wavlake, and public Nostr profiles were checked. Name-only matches and unclear ownership were retained as unresolved rather than counted.

- Say She She (265 spins; 64dad611-8ada-4696-ac5f-ecb8bf73d51b) — unresolved_no_verified_destination; No Lightning address, LNURL-pay destination, or payable Nostr profile was found with an official-site or canonical MusicBrainz identity backlink. Name-only catalog or profile matches, if any, were not accepted.
- Slowdive (215 spins; a16371b9-7d36-497a-a9d4-42b0a0440c5e) — unresolved_no_verified_destination; No Lightning address, LNURL-pay destination, or payable Nostr profile was found with an official-site or canonical MusicBrainz identity backlink. Name-only catalog or profile matches, if any, were not accepted.
- Roxy Music (214 spins; 331ce348-1b08-40b9-8ed7-0763b92bd003) — unresolved_no_verified_destination; No Lightning address, LNURL-pay destination, or payable Nostr profile was found with an official-site or canonical MusicBrainz identity backlink. Name-only catalog or profile matches, if any, were not accepted.
- Jeff Mills (202 spins; 470a4ced-1323-4c91-8fd5-0bb3fb4c932a) — unresolved_no_verified_destination; No Lightning address, LNURL-pay destination, or payable Nostr profile was found with an official-site or canonical MusicBrainz identity backlink. Name-only catalog or profile matches, if any, were not accepted.
- Eguana (183 spins; 1400f9b3-96a9-4017-9590-961180ee3934) — unresolved_no_verified_destination; No Lightning address, LNURL-pay destination, or payable Nostr profile was found with an official-site or canonical MusicBrainz identity backlink. Name-only catalog or profile matches, if any, were not accepted.
- Cocteau Twins (180 spins; 000fc734-b7e1-4a01-92d1-f544261b43f5) — unresolved_no_verified_destination; No Lightning address, LNURL-pay destination, or payable Nostr profile was found with an official-site or canonical MusicBrainz identity backlink. Name-only catalog or profile matches, if any, were not accepted.
- INXS (175 spins; 481bf5f9-2e7c-4c44-b08a-05b32bc7c00d) — unresolved_no_verified_destination; No Lightning address, LNURL-pay destination, or payable Nostr profile was found with an official-site or canonical MusicBrainz identity backlink. Name-only catalog or profile matches, if any, were not accepted.
- Depeche Mode (171 spins; 8538e728-ca0b-4321-b7e5-cff6565dd4c0) — unresolved_no_verified_destination; No Lightning address, LNURL-pay destination, or payable Nostr profile was found with an official-site or canonical MusicBrainz identity backlink. Name-only catalog or profile matches, if any, were not accepted.
- Altın Gün (169 spins; cd5799f6-e6cf-4322-a659-96f5de4a2f6c) — unresolved_no_verified_destination; No Lightning address, LNURL-pay destination, or payable Nostr profile was found with an official-site or canonical MusicBrainz identity backlink. Name-only catalog or profile matches, if any, were not accepted.
- Neil Young (158 spins; 75167b8b-44e4-407b-9d35-effe87b223cf) — unresolved_no_verified_destination; No Lightning address, LNURL-pay destination, or payable Nostr profile was found with an official-site or canonical MusicBrainz identity backlink. Name-only catalog or profile matches, if any, were not accepted.
- Steve Roach (156 spins; 8347dd6d-b9a2-4e96-a610-d1ed67b189f1) — unresolved_no_verified_destination; No Lightning address, LNURL-pay destination, or payable Nostr profile was found with an official-site or canonical MusicBrainz identity backlink. Name-only catalog or profile matches, if any, were not accepted.
- Stereolab (150 spins; f1df0431-9250-4ec8-95d8-f19ce7cf7fb6) — unresolved_no_verified_destination; No Lightning address, LNURL-pay destination, or payable Nostr profile was found with an official-site or canonical MusicBrainz identity backlink. Name-only catalog or profile matches, if any, were not accepted.
- Bonobo (146 spins; 9a709693-b4f8-4da9-8cc1-038c911a61be) — unresolved_no_verified_destination; No Lightning address, LNURL-pay destination, or payable Nostr profile was found with an official-site or canonical MusicBrainz identity backlink. Name-only catalog or profile matches, if any, were not accepted.
- Simple Minds (135 spins; f41490ce-fe39-435d-86c0-ab5ce098b423) — unresolved_no_verified_destination; No Lightning address, LNURL-pay destination, or payable Nostr profile was found with an official-site or canonical MusicBrainz identity backlink. Name-only catalog or profile matches, if any, were not accepted.
- John Coltrane (134 spins; b625448e-bf4a-41c3-a421-72ad46cdb831) — unresolved_no_verified_destination; No Lightning address, LNURL-pay destination, or payable Nostr profile was found with an official-site or canonical MusicBrainz identity backlink. Name-only catalog or profile matches, if any, were not accepted.
- The Beatles (132 spins; b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d) — unresolved_no_verified_destination; No Lightning address, LNURL-pay destination, or payable Nostr profile was found with an official-site or canonical MusicBrainz identity backlink. Name-only catalog or profile matches, if any, were not accepted.
- The Police (131 spins; 9e0e2b01-41db-4008-bd8b-988977d6019a) — unresolved_no_verified_destination; No Lightning address, LNURL-pay destination, or payable Nostr profile was found with an official-site or canonical MusicBrainz identity backlink. Name-only catalog or profile matches, if any, were not accepted.
- Big Thief (129 spins; 9f81247f-7f57-42f3-a8ba-75bef554e591) — unresolved_no_verified_destination; No Lightning address, LNURL-pay destination, or payable Nostr profile was found with an official-site or canonical MusicBrainz identity backlink. Name-only catalog or profile matches, if any, were not accepted.
- Nils Petter Molvær (126 spins; 4a0308e2-6b10-4cd9-9551-c7613c09dc17) — unresolved_no_verified_destination; No Lightning address, LNURL-pay destination, or payable Nostr profile was found with an official-site or canonical MusicBrainz identity backlink. Name-only catalog or profile matches, if any, were not accepted.
- The Rolling Stones (126 spins; b071f9fa-14b0-4217-8e97-eb41da73f598) — unresolved_no_verified_destination; No Lightning address, LNURL-pay destination, or payable Nostr profile was found with an official-site or canonical MusicBrainz identity backlink. Name-only catalog or profile matches, if any, were not accepted.
- Johnny Cash (126 spins; d43d12a1-2dc9-4257-a2fd-0a3bb1081b86) — unresolved_no_verified_destination; No Lightning address, LNURL-pay destination, or payable Nostr profile was found with an official-site or canonical MusicBrainz identity backlink. Name-only catalog or profile matches, if any, were not accepted.
- Mathias Grassow (124 spins; 0606eb21-69d1-4e38-99f5-ffc8120f24d0) — unresolved_no_verified_destination; No Lightning address, LNURL-pay destination, or payable Nostr profile was found with an official-site or canonical MusicBrainz identity backlink. Name-only catalog or profile matches, if any, were not accepted.
- The Pretenders (124 spins; e9c832b0-384b-4ee6-aec0-111372784aac) — unresolved_no_verified_destination; No Lightning address, LNURL-pay destination, or payable Nostr profile was found with an official-site or canonical MusicBrainz identity backlink. Name-only catalog or profile matches, if any, were not accepted.
- Charles Mingus (121 spins; f3b8e107-abe8-4743-b6a3-4a4ee995e71f) — unresolved_no_verified_destination; No Lightning address, LNURL-pay destination, or payable Nostr profile was found with an official-site or canonical MusicBrainz identity backlink. Name-only catalog or profile matches, if any, were not accepted.
- Fontaines D.C. (118 spins; fd87acc7-e0a0-4a45-bc2a-d2ab5c10be68) — unresolved_no_verified_destination; No Lightning address, LNURL-pay destination, or payable Nostr profile was found with an official-site or canonical MusicBrainz identity backlink. Name-only catalog or profile matches, if any, were not accepted.

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
