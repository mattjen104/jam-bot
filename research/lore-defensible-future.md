# Lore's defensible future

**Strategy memo · 17 September 2026 · research status: decision support, not a
product roadmap**

## Executive summary

Lore should not try to become a universal streaming player, a general social
network, or an AI music generator. Those are feature-count contests against
Parachord, Spotify, Apple, Stationhead, Discord, and generative-music
companies, while Lore has neither their distribution nor their licensing
position.

Lore's credible advantage is narrower and more valuable: **a trustworthy
music provenance layer that turns human-curated radio into durable, portable
listening intent**. A listener can discover a track through a real station,
retain the album/artist/show/time evidence, investigate it, support the
creator, and launch or export it through the listener's chosen provider.
Provider playback remains a handoff, not a promise Lore controls.

**Primary direction: Radio-to-record, a paid provenance and album-discovery
utility.** Make the existing radio evidence, keeps, album grouping, replay,
sharing, exports, and direct-support links one exceptionally reliable loop.
Charge for the durable personal archive, richer investigation, and export
automation—not for catalog access.

**One compatible secondary wedge: a small “listening room” around a recorded
radio run or album investigation.** It should be an invite/share layer built on
existing provenance, not a new social graph or multi-provider synchronized
player. Test it only after the primary loop shows repeat use.

The strategic choice is **integrate rather than clone**:

* Build MusicBrainz identity joins, honest JSPF/XSPF/CSV/M3U8 interchange, and
  artist-support links.
* Offer user-triggered Spotify and Apple Music handoff; experiment with
  ListenBrainz, AT Protocol/Rocksky sharing, and a Parachord file/deep-link
  contract.
* Do not claim provider-agnostic ownership or playback when the result is only
  a link-out.
* Stop investing in a broad social feed, general AI copilot, generic globe/map
  discovery, and a Spotify/Stationhead replacement.

No adoption, revenue, or market-size number was available in the research.
Longplay demonstrates that a small paid album utility can exist; Bandcamp
demonstrates artist-support conversion; neither proves Lore demand. The next
step is a 30-day willingness-to-pay and repeat-use test, not a large build.

## Claim legend and method

* **[LIVE]**: observed on an official product, store, or documentation page at
  the access date.
* **[REPO]**: repository README, release, issue, or roadmap claim. It is not
  proof of production reliability, adoption, or revenue.
* **[INFER]**: strategic interpretation of the evidence.
* **[UNAVAILABLE]**: not found or not verifiable; this memo does not fill the
  gap with an estimate.

The named-product research and adjacent research were checked 2026-09-17.
Store prices, quotas, APIs, and product features can change. “Free”, “open
source”, or a public repository is not evidence of a sustainable business.

## Market map by job

| Job / moment | Products with a clear advantage | What users actually want | Lore's position |
|---|---|---|---|
| Own a durable music identity | Rocksky, ListenBrainz, Plexamp | History that survives provider changes | Use MBIDs and exports; do not pretend a link is ownership |
| Find and enjoy complete albums | Longplay, Plexamp, Apple Music | Less clutter, an intentional album ritual | Add radio provenance and investigation, not another album grid |
| Discover through people | Achordion, Rocksky, Stationhead | Taste signals, selectors, context | Existing selector/radio evidence is differentiated; social graph is not |
| Listen together | Spotify Jam, SharePlay, Stationhead, Discord Activities | A synchronous shared moment | Small invite room around a run; no cross-provider playback moat |
| Understand music | MusicBrainz, Wikipedia/Genius-style enrichment, specialist media | Trustworthy context without hallucination | Cite sources and provenance; narrow AI explanation is useful |
| Support creators | Bandcamp, direct artist stores | A clear action at the moment of intent | Route, do not intermediate checkout or scrape |
| Escape service lock-in | Parachord, open formats, ListenBrainz | Portable IDs, playlists, and history | Build interchange and provider adapters |
| Make listening playful | Radio Garden, Spotify discovery, Lore ghost replay | Serendipity and a reason to return | Ghost Radio and seeded crossings are stronger than a generic map |

The underserved intersection is **human-curated discovery + evidence + action**:
“What was that album, who played it, why should I care, and where can I hear
or buy it?” Lore can own that question without owning audio.

## Named-product comparison

| Product | Purpose, audience, core workflow | Maturity / strengths | Limits, economics, integration surface |
|---|---|---|---|
| **Parachord** | [LIVE] Free/open-source multi-source player for listeners who want one interface over services and local files: resolve a song/album/playlist, choose a preferred source, play, sync library/favorites, share links. | [LIVE]/[REPO] macOS, Windows, Linux releases; Android public beta described as a full player. MIT repository, releases included v0.9.6 on 2026-07-15. Broadest ownership/interoperability ambition; repository/site claim Spotify, Apple Music, SoundCloud, YouTube Music, Bandcamp, Tidal, local files, browser extensions, purchase/download, recommendations and AI Shuffleupagus. | [LIVE] No paid tier shown; free/open source. [UNAVAILABLE] MAU, revenue, conversion, SLA, licensing agreements, and independent adoption. Provider APIs, matching, and licensing are substantial risks. No stable public Lore handoff API was verified. **Lore posture:** partner/hand off via portable files first, never depend on it. Sources: [parachord.com](https://parachord.com/), [repository](https://github.com/Parachord/parachord), [releases](https://github.com/Parachord/parachord/releases). |
| **Achordion** | [REPO] Open-source web/community front end for ListenBrainz, with identity/profile, feeds, discovery, and “Play in Parachord” handoff. | [REPO] MIT, created 2026, active commits through 2026-09-10, sister project to Parachord. Useful proof that identity/feed and playback can be separate layers. | [UNAVAILABLE] Verified hosted scale, app-store binaries, pricing, revenue, and production SLA; no releases at access. Early/open-source companion, not a mature consumer network. **Lore posture:** exchange formats and explore maintainer interoperability; do not clone its feed. Sources: [repo](https://github.com/jherskowitz/achordion), [commits](https://github.com/jherskowitz/achordion/commits/main), [Parachord description](https://parachord.com/blog/2026/05/18/achordion-grows-up-identity-feeds-and-a-tighter-parachord-knot). |
| **Rocksky** (requested “Rocksy” appears to be a typo) | [LIVE] Decentralized, open-source Last.fm alternative on AT Protocol: scrobble from Spotify/Jellyfin/Navidrome/Kodi and clients, publish to a user PDS, follow, like, view charts, export/migrate. | [LIVE] Clear portable identity and social-scrobble model; typed SDKs/API/MCP and migration docs. Free hosted login; self-hostable source. | [UNAVAILABLE] Pricing, MAU, revenue, SLA, and scale. It is not a player, album ritual, radio provenance system, or artist-commerce layer. Lore's separate scrobble research found no defensible station-owned actor: never treat Rocksky data as station truth. **Lore posture:** opt-in listener export experiment only. Sources: [docs](https://docs.rocksky.app/), [quickstart](https://docs.rocksky.app/quickstart), [FAQ](https://docs.rocksky.app/faq), [source](https://tangled.org/rocksky.app/rocksky). |
| **Longplay** | [LIVE] Focused Apple-library album player: surface albums the listener owns or nearly owns, sort collections, play complete albums, widgets/CarPlay/Shortcuts/VoiceOver. | [LIVE] Mature Apple-native scope across iOS, macOS, visionOS; store reviews and ongoing releases provide real adoption signal. One-time purchase positioning is evidence for a simple premium ritual. | [LIVE] Price evidence conflicts: presskit lists iOS USD 5.99 and visionOS USD 25, while storefront/search showed other current prices; verify at decision time. [UNAVAILABLE] Revenue, MAU, retention. Apple/iCloud dependent and does not solve radio provenance. **Lore posture:** benchmark the ritual and possibly hand off; do not out-feature it. Sources: [home](https://longplay.rocks/), [presskit](https://longplay.rocks/presskit), [FAQ](https://longplay.rocks/faq), [iOS store](https://apps.apple.com/us/app/longplay/id1495152002). |

## Bounded adjacent comparison

| Adjacent | Verified signal | Lesson for Lore |
|---|---|---|
| ListenBrainz / MusicBrainz | [LIVE] Open listen tracking, APIs, tokens, MBID/ISRC metadata and relationships; MusicBrainz asks clients for meaningful User-Agent and rate discipline. | Best identity/interchange substrate, weak paid benchmark. Build export/import and metadata joins. |
| Bandcamp | [LIVE] Direct digital/physical fan sales; published fee schedule, subscriptions and Pro product. | Strongest artist-support conversion evidence. Link to official pages; do not take payment or scrape. |
| Apple Music MusicKit / SharePlay | [LIVE] Authorized apps can search, create playlists, add to library and play; SharePlay is Apple-platform group listening. | Provider handoff is useful; entitlement, storefront, OS and subscription boundaries prevent portable ownership. |
| Spotify / Jam | [LIVE] Jam is a Spotify session; API has quotas, 429s and 2026 development-mode restrictions; Premium is required for new development-mode apps per migration docs. | High reach, unsafe foundation for service neutrality. Cache IDs, request least scope, hand off on user action. |
| Stationhead | [LIVE] Personality-led live social radio, up to four speakers, iOS/Android/Web, Spotify/Apple only, tips. | Synchronous fan moments work; provider limits and licensing mean Lore should differentiate on independent-radio evidence. |
| Discord Activities | [LIVE] Embeddable web apps with discovery/monetization surfaces. | Distribution/rooms are available through partnership; building a graph and music licensing stack is unnecessary. |
| Plexamp | [LIVE] Polished personal-library player, offline/automotive and discovery features, free core with Plex Pass extras. | Paid library UX exists, but its owner/self-host audience does not solve provenance or artist support. |
| Suno / Moises | [LIVE] Suno monetizes generative creation/rights tiers; Moises monetizes concrete stem/practice/remix utility. | AI willingness-to-pay is not evidence for an AI listening host. Explain and curate; do not generate or process catalog audio. |
| Radio Garden / SomaFM | [LIVE] Map-based worldwide radio discovery; SomaFM runs listener-supported curated channels. | Discovery and listener support are emotionally legible. Lore's seeded crossing and provenance are a stronger retention loop than a generic map. |

## Lore capability audit

| Capability | Status | Evidence and honest friction |
|---|---|---|
| Portable/service-agnostic library | **Partial** | Connector contract exists, but Spotify is the complete implementation; Apple/Tidal registry is not equivalent to parity. MusicBrainz-resolved items and Spotify soft rows still depend on provider OAuth/matching. |
| Import/export and provider handoff | **Shipped / partial** | Spotify import/mirroring, Odesli cross-service links, and JSPF/XSPF/M3U8/CSV replay exports exist. Generic `lore.library.v1` round-trip import is aspirational; exports are link-outs, not audio ownership. |
| Artist support | **Shipped / partial** | Artist routes, MB-centered identity, merchandise/events enrichment and artist surfaces exist. No core artist claim/conversion funnel or evidence of completed purchase attribution. |
| Social listening/rooms | **Shipped but specialized** | Apple Music Jam has rooms, modes, SSE, clock sync, ACR clips and anchoring. It is not a general public social graph, chat, or cross-provider room; streak state is in memory. |
| AI knowledge/interaction | **Shipped / partial / aspirational** | Recording enrichment, Wikipedia/Genius/insights, OCR and Slack jam-bot exist. No general in-product conversational Lore copilot. External keys and asynchronous sparse-first enrichment add friction. |
| Radio provenance | **Shipped / strong, partial coverage** | ICY/watchers, station/run evidence, timestamps, spin IDs, source/citation, shares and honest unresolved states are a real advantage. Accuracy remains bounded by station feed, scraper, schedule and MB resolution. |
| Album experience | **Shipped / partial** | Album grouping/routes/replay data exist, but album tracks and launch are Spotify dependent; classic albums are experimental/hidden rather than a broad product. |
| Knowledge/investigation | **Shipped / partial** | Context and sources are available through enrichment and the architecture's investigation layer. Coverage and freshness vary; avoid presenting sparse enrichment as certainty. |
| Sharing | **Shipped** | Server-rendered OG pages, cards, song/station/run/picker shares, Odesli links and jam-bot link-only cards work. External redirects and enrichment failures remain. |
| Replay | **Shipped / partial** | Ghost Radio, fixed past queues, guided replay, resolution/materialization jobs and robust exports exist. Playability depends on service mapping, entitlement and exact IDs. |
| Playful discovery | **Shipped lightly / experimental** | Ghost Zone, “new to you”, selector trove and Apple Jam match streaks exist. No persistent achievements, quests, leaderboards or generalized game loop. |

## Six product theses

Scores are 1–5: 5 is stronger. “Cost” and “risk” are inverted (5 = low).

### Scorecard

| Thesis | User urgency | Delight | Pay | Distribution | Retention | Build/marginal cost | Provider/licensing safety | Lore advantage | Total / 40 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1. **Radio-to-record utility** | 4 | 4 | 3 | 3 | 4 | 4 | 4 | 5 | **31** |
| 2. **Premium album ritual** | 3 | 5 | 4 | 2 | 4 | 3 | 3 | 3 | **27** |
| 3. **Cross-service social listening** | 3 | 4 | 3 | 3 | 3 | 2 | 1 | 2 | **21** |
| 4. **AI-native social host** | 2 | 4 | 3 | 2 | 3 | 2 | 2 | 2 | **20** |
| 5. **Ownership/support passport** | 4 | 3 | 3 | 2 | 4 | 3 | 4 | 4 | **27** |
| 6. **Human-radio/provenance network** | 3 | 5 | 3 | 3 | 5 | 3 | 4 | 5 | **31** |

The tie is deliberate: thesis 1 is the monetizable narrow utility; thesis 6
is its positioning and supply-side moat. Thesis 5 is a compatible substrate,
not a standalone launch.

### Thesis 1 — Radio-to-record utility (primary)

* **Target/job/emotion:** curious radio listeners who repeatedly ask “what was
  that?”; recover a track, understand it, keep the album, and act. The emotion
  is relief and trust.
* **Smallest compelling product:** station crossing feed → one-click keep →
  provenance receipt → album grouping → source/artist-support links → provider
  handoff and export.
* **Monetization/distribution:** $5–8/month or $49/year for durable archive,
  richer sources, bulk export and replay utilities; free feed as acquisition,
  station/selector shares, SEO cards and independent-radio partnerships.
* **Defensibility:** station evidence, timestamps, selector/show graph,
  unresolved honesty, and accumulated personal provenance. Provider-independent
  IDs deepen the moat.
* **Provider/operating burden:** moderate; station ingestion quality,
  MusicBrainz/Odesli refresh, support for failed matches. No audio catalog
  licensing if playback is handoff.
* **Why it can fail:** users may prefer free station apps; “what was that?” may
  be episodic; unresolved coverage can break trust; direct-support links may
  not convert.

### Thesis 2 — Premium album experience

* **Target/job/emotion:** album listeners overwhelmed by algorithmic feeds who
  want an intentional evening ritual. The emotion is attention and completion.
* **Smallest product:** beautiful text-first album queue, provenance note,
  investigation sheet, “launch where you listen”, full-album session and
  export.
* **Monetization/distribution:** $29–60 one-time or $4/month; Apple/macOS
  community, Longplay comparison, Lore radio shares.
* **Defensibility:** provenance/context, not album browsing alone.
* **Burden/risk:** provider entitlements, artwork/catalog IDs and a crowded
  Apple-native space. Longplay shows the simple product can work, but Lore
  should not duplicate its Apple library UX.

### Thesis 3 — Cross-service social listening

* **Target/job/emotion:** friends and selectors wanting a shared session across
  services. Emotion is belonging and surprise.
* **Smallest product:** invite-only room anchored to a run or album; participants
  see the same metadata/provenance and open locally.
* **Monetization/distribution:** free rooms, $5/month host archive or event
  tools; Discord/selector/station distribution.
* **Defensibility:** shared evidence and replay, not synchronized audio.
* **Burden/risk:** difficult sync, provider APIs, licensing, cold-start social
  graph. Stationhead/Spotify/SharePlay already own the synchronous moment.

### Thesis 4 — AI-native social host

* **Target/job/emotion:** groups wanting a knowledgeable host that explains
  transitions and remembers context. Emotion is intimacy/serendipity.
* **Smallest product:** cited AI recap of a radio run or room, questions answered
  from trusted source cards, suggested next album with explicit uncertainty.
* **Monetization/distribution:** $8–12/month premium room/recap; shareable
  recaps and creator communities.
* **Defensibility:** provenance-grounded context and private room history.
* **Burden/risk:** inference cost, hallucination liability, moderation/privacy,
  weak willingness to pay for chat. AI creation products prove utility can sell,
  not this specific use. Keep as an experiment inside thesis 1.

### Thesis 5 — Ownership/support passport

* **Target/job/emotion:** listeners who want their identity, history, playlists
  and creator support to survive provider changes. Emotion is agency.
* **Smallest product:** MBID-centered personal ledger; import/export JSPF/XSPF;
  provider IDs and artist purchase links; optional ListenBrainz/Rocksky publish.
* **Monetization/distribution:** $3–6/month, annual export/backup tier, open
  free core; open-source and interoperability communities.
* **Defensibility:** trusted portable graph and user-controlled export.
* **Burden/risk:** users may not pay for data portability; matching and deletion
  are hard; Parachord and Rocksky already occupy adjacent open space. Make it
  a feature of the primary product, not a standalone identity network.

### Thesis 6 — Human-radio/provenance network

* **Target/job/emotion:** independent-radio listeners, selectors and stations
  who value human taste and evidence over recommendation sludge. Emotion is
  discovery with a place and person attached.
* **Smallest product:** verified station/run pages, selector attribution,
  crossing feed, ghost replay, shareable evidence cards and station/artist
  support buttons.
* **Monetization/distribution:** station sponsorship/paid archives, listener
  premium, station partnerships; station pages and selector shares.
* **Defensibility:** difficult-to-recreate station history and provenance graph.
* **Burden/risk:** station onboarding, feed reliability, two-sided acquisition;
  stations may have no budget. Positioning for thesis 1, not a separate social
  network.

## The simple MusicKit question

Could a simple Apple MusicKit product beat a technically broader platform?

**Yes for a focused album ritual, no for Lore's core opportunity.** Longplay
shows that one platform can reduce matching, entitlement, and UI scope enough
to deliver a polished paid experience. Apple provides catalog/search/playlist
and SharePlay primitives, and a native app can outperform a broad web
abstraction in responsiveness and finish.

But an Apple-only product discards Lore's strongest input: radio evidence from
stations and users whose preferred service varies. Apple MusicKit requires
authorization/subscription and has storefront/platform boundaries. Therefore:

1. Do not make Apple the identity layer or promise cross-service ownership.
2. Use MusicKit as an opt-in launch adapter and, if validated, a thin premium
   Apple album surface.
3. Let MusicBrainz IDs, raw text, provenance and portable export remain primary.
4. Test an Apple-native micro-product only if interviews show a concentrated
   Apple album audience willing to pay; do not build it pre-validation.

## Standards-first integration plan

The durable internal object should be a `RecordingRef`: recording/artist/
release/release-group MBIDs, raw artist/title, ISRC, provider IDs/URLs,
match confidence, provenance, and observed timestamps. Every authorization is
per-provider, least-scope, encrypted, revocable, and user-triggered.

| Surface | Classification and data flow | User benefit / failure honesty |
|---|---|---|
| **MusicBrainz** | **BUILD.** Station observation → resolver → MBID; cache with User-Agent/rate discipline; retain raw text and confidence on ambiguity. | Stable joins and investigation. Edits, merges, missing recordings and outage never silently overwrite raw evidence. |
| **JSPF/XSPF/CSV** | **BUILD.** Export MBIDs, raw text, album, provenance, source URL and confidence; implement a bounded, validated import that retains unresolved rows. | Durable round trip. Validate size/XML/JSON and reject unsafe URLs; unresolved means unresolved. |
| **M3U8** | **BUILD narrowly.** Use only as stream/ghost-replay pointer; never call it a library or ownership format. | Portable station replay. Segment/URL expiry and unavailable streams are explicit. |
| **ListenBrainz** | **BUILD export first; experiment submission.** After a listener actually hears a track, consented outbox submits with MBID; token/server ledger handles retries and deletion. Never submit station observations as personal listens. | User-owned history and migration. Honor revocation, rate limits, duplicate suppression and privacy. |
| **AT Protocol / Rocksky** | **EXPERIMENT.** Opt-in DID-scoped share/scrobble with DID, rkey, CID, timestamp and PDS; honor deletion. | Portable public sharing for users who choose it. Public repository integrity does not prove station identity; never use it for radio ingestion. |
| **Bandcamp/direct artist support** | **BUILD link-out.** Resolved artist/album → artist-claimed or reliably supplied canonical URL. No checkout, scraping, or invented MBID-to-page mapping. | One clear support action with payment/privacy owned by Bandcamp/artist. Track only approved outbound analytics. |
| **Apple Music MusicKit** | **BUILD adapter.** Backend developer token stays secret; browser/native obtains Music User Token; MBID/ISRC → catalog ID → queue/play, URL fallback. | Convenient opt-in playback. Subscription, storefront, token expiry, catalog gaps and platform differences are visible. |
| **Spotify** | **BUILD narrow handoff/import.** PKCE, least scopes, encrypted revocable token; resolve IDs/ISRC, create/update playlist only on user action or open URI. | Reach and familiar launch. Rate limits, quotas, region/availability and policy restrictions apply; never cache audio or train AI on Spotify content. |
| **Parachord** | **PARTNER/EXPERIMENT.** Start with JSPF/XSPF/M3U8 and canonical URLs; ask maintainers for documented URI/file/IPC contract before adding deep link. | Users can continue in an open multi-source player. App/version absence and unresolved IDs are normal failure states. |

## Recommendation and stop list

### Portfolio

1. **Primary: Radio-to-record utility / human provenance network.** Preserve and
   sharpen the crossing → keep → album → investigate → launch/support/replay
   loop. Paid value is durable evidence and action, not audio access.
2. **Secondary: invite-only evidence rooms.** A room can discuss/replay a run
   or album and share the same cited context. It strengthens the primary loop
   without requiring a new universal social graph.

Existing radio ingestion, `HomeDiscovery`, seed suggestions, album/library
work, Ghost Radio, replay exports, share cards, artist surfaces and Apple Jam
are valuable assets. The interface architecture's Feed/Stack and text-first
rows are aligned with this direction.

### Do not build now / archive

* A universal player with cached audio or a provider-neutral entitlement claim.
* Spotify/Stationhead-style social graph, public chat, or synchronized
  cross-provider playback.
* A general-purpose AI music companion, generated catalog music, or AI training
  on provider content.
* A generic globe/map radio directory; link to or complement Radio Garden.
* A broad achievements/points/leaderboard game layer.
* A payment intermediary, unofficial Bandcamp scraper, or artist marketplace.
* Rocksky/Last.fm account ingestion as station truth.
* Feature-parity work with Parachord, Achordion, or Longplay.
* A broad classic-album editorial program before the paid album demand test.

Archive sunk work that cannot be tied to provenance, a keep, an investigation,
an export/handoff, support conversion, or a repeatable room moment. “Could
integrate someday” is not a roadmap item.

## 30-day validation portfolio

### Days 1–7: demand and price

Interview 15 listeners who use independent radio, 5 selectors/stations, and 5
album-focused listeners. Show a clickable but non-production flow using real
station evidence and three unresolved cases. Test landing pages for:

* “Never lose the story behind a song you found on radio.”
* “Your radio discoveries, organized into albums you can actually launch.”
* “A portable receipt for what you heard, where, and who played it.”

Randomize a $5/month, $8/month, $49/year, and $29 one-time album-utility
offer. Do not count email-only interest as payment intent.

### Days 8–14: concierge utility

Run 20 real discovery cases manually: capture station/show/time, resolve MBID,
group album, attach two source cards, artist-support URL, and at least two
provider links. Record time-to-answer, match confidence, unresolved reasons,
and whether the user launches, saves, shares, or supports.

### Days 15–21: thin product and room test

Ship no new provider. Use existing feed/Stack/share/replay surfaces plus a
manual export. Give 10 users a weekly archive and invite 5 pairs into a
recorded-run discussion room. Test one MusicKit launch and one Spotify handoff
only where users already have entitlement. Ask users to export a JSPF/XSPF
artifact and import it into a compatible tool manually.

### Days 22–30: paid continuation decision

Offer the strongest two prices to the most engaged cohort, measure second-use
within seven days, and conduct exit interviews. Compare radio provenance with
an album-only variant; the former must earn retention rather than merely
explain Lore's existing engineering.

### Continue thresholds

Continue the primary direction if all are true:

* At least 20 of 25 interviewed listeners describe the same provenance problem
  without prompting; at least 12 rank it in their top three music frustrations.
* In the concierge cohort, at least 60% complete a second discovery action
  (keep, investigate, launch, export, share, or support) within seven days.
* At least 40% return for a second radio discovery within 14 days.
* At least 8 of 20 users pay, pre-order, or leave a refundable deposit at one
  of the tested prices; verbal “I would pay” does not count.
* At least 80% of captured cases retain a confident identity/provenance trail;
  the remaining cases show an honest unresolved state rather than a wrong
  match.
* At least 3 stations/selectors agree to share or link the cards, or 10 users
  organically share them.

Continue the room wedge only if at least 5 of 10 invited pairs complete a
second room action and at least 3 ask for another room without prompting. Do
not infer network effects from a founder-created room.

Qualitative continuation requires users to say that provenance changed what
they listened to, bought, or returned to—not merely that the interface looked
nice. A station/selector must describe the evidence as useful to their
audience, not just a free promotional page.

### Stop or pivot conditions

Stop the paid provenance build if fewer than 5 of 20 users pay/deposit after
seeing a working concierge result, or if fewer than 25% return for a second
discovery. Stop the room wedge if it requires founder moderation for every
session or fewer than 3 pairs request another room. Stop a provider adapter if
successful exact resolution is below 70% in a representative 30-item test,
authorization abandonment exceeds 50%, or provider policy prevents the
intended workflow. Stop AI expansion if cited answers are wrong in more than
5% of reviewed responses or users do not choose AI over the source cards.

If provenance demand is strong but payment is weak, keep it free as a
station/artist acquisition layer and test a paid export/archive tier. If album
ritual demand is strong only among Apple users, run the small MusicKit product
as a separate experiment; do not broaden Lore prematurely.

## Bottom line

Lore does not need to win at playing every song, hosting every friend, or
answering every music question. It can win the moment competitors leave
unresolved: **a person heard something in a human-curated place and wants to
carry the discovery forward with evidence and agency**. Make that loop
beautiful, portable, source-linked, and commercially useful to listeners,
artists, selectors, and stations. Charge for durable utility. Keep providers,
formats, and social networks at the boundary. If users will not pay or return
for that loop after 30 days of honest testing, archive the broader vision
rather than turning Lore into an undifferentiated music super-app.

## Sources (accessed 2026-09-17)

### Named products

* Parachord: <https://parachord.com/>; <https://github.com/Parachord/parachord>;
  <https://github.com/Parachord/parachord/releases>;
  <https://parachord.com/blog/2026/04/20/parachord-android-first-public-beta>
* Achordion: <https://github.com/jherskowitz/achordion>;
  <https://github.com/jherskowitz/achordion/commits/main>;
  <https://parachord.com/blog/2026/05/18/achordion-grows-up-identity-feeds-and-a-tighter-parachord-knot>
* Rocksky: <https://docs.rocksky.app/>; <https://docs.rocksky.app/quickstart>;
  <https://docs.rocksky.app/faq>; <https://tangled.org/rocksky.app/rocksky>
* Longplay: <https://longplay.rocks/>; <https://longplay.rocks/presskit>;
  <https://longplay.rocks/faq>;
  <https://apps.apple.com/us/app/longplay/id1495152002>

### Adjacent products and standards

* ListenBrainz: <https://listenbrainz.org/>;
  <https://listenbrainz.readthedocs.io/en/latest/users/api/>
* MusicBrainz API and rate limits: <https://musicbrainz.org/doc/MusicBrainz_API>;
  <https://musicbrainz.org/doc/Rate_Limiting>
* Bandcamp fees/subscriptions/Pro: <https://get.bandcamp.help/en/articles/15263193-what-are-bandcamp-s-fees>;
  <https://bandcamp.com/subscriptions>; <https://bandcamp.com/pro>
* Apple Music MusicKit: <https://developer.apple.com/musickit/>;
  <https://developer.apple.com/musickit/web/>;
  <https://developer.apple.com/documentation/musickitjs>
* Spotify Jam/API/policy: <https://support.spotify.com/us/article/jam/>;
  <https://developer.spotify.com/documentation/web-api/concepts/quota-modes>;
  <https://developer.spotify.com/documentation/web-api/concepts/rate-limits>;
  <https://developer.spotify.com/policy>
* Stationhead: <https://stationhead.com/faqs>; <https://www.stationhead.com/>
* Discord Activities: <https://docs.discord.com/developers/activities/overview>
* Plexamp: <https://plexamp.com/>
* Suno and Moises: <https://suno.com/pricing>; <https://moises.ai/pricing>
* Radio Garden and SomaFM: <https://radio.garden/>; <https://somafm.com/>
* AT Protocol and Rocksky actor API:
  <https://atproto.com/specs/repository>;
  <https://docs.rocksky.app/api-reference/approckskyactor/get-scrobbles-for-an-actor.md>
* JSPF/XSPF/M3U8: <https://musicbrainz.org/doc/jspf>;
  <https://xspf.org/spec>; <https://www.rfc-editor.org/rfc/rfc8216.html>
* Spotify authorization/scopes: <https://developer.spotify.com/documentation/web-api/concepts/authorization>;
  <https://developer.spotify.com/documentation/web-api/concepts/scopes>

### Lore repository and research evidence

* Unified interface architecture: `artifacts/lore/INTERFACE_ARCHITECTURE.md`
* Player, seed and discovery surfaces:
  `artifacts/lore/src/webplayer/WebPlayer.tsx`,
  `artifacts/lore/src/components/SeedSuggestions.tsx`,
  `artifacts/lore/src/components/HomeDiscovery.tsx`
* Replay and rooms:
  `artifacts/api-server/src/routes/lore/replay.ts`,
  `artifacts/api-server/src/routes/lore/apple-music-jams.ts`
* Shares: `artifacts/api-server/src/routes/share/index.ts`
* Scrobble-source evaluation: `research/scrobble-now-playing-evaluation.md`