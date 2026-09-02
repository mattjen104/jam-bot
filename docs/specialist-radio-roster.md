# Specialist Radio roster

Reviewed **2026-09-02**. This is the final 20-station cohort. “Shallow” means
Lore may import only the broadcaster’s current rolling window; it does not
claim an older archive. Programme archives are cited for identity and listening
only and are never converted into invented track rows.

| Station | Place | Official identity / playable stream | Live metadata | Public history and permitted extraction | Expected depth | Why included |
|---|---|---|---|---|---|---|
| Kiosk Radio | Brussels, BE | [Official](https://www.kioskradio.com/), 192k AAC | Programme | Official programme archive; no inferred tracks | Programme only | Adventurous club and experimental selectors |
| Lahmacun Radio | Budapest, HU | [Official](https://lahmacun.hu/), 128k MP3 | Programme | Official programme pages; no inferred tracks | Programme only | Regional and experimental breadth |
| Oroko Radio | Accra, GH | [Official](https://www.oroko.live/), 320k MP3 | Programme | Official programme archive; no inferred tracks | Programme only | African and diasporic electronic music |
| LYL Radio | Lyon, FR | [Official](https://lyl.live/), 192k MP3 | Programme | Official archive pages; no inferred tracks | Programme only | Left-field ambient and experimental radio |
| KEXP 90.3 FM | Seattle, US | [Official](https://www.kexp.org/), 128k MP3 | Track | Official KEXP API with dated airdate cursor and stable play id | **Deep, cursor-safe history** | Human-curated global music discovery with unusually strong public play history |
| 8Ball Radio | New York, US | [Official browser player](https://8ballradio.nyc/) | Programme only | Official Mixcloud-linked show archive; no track extraction | Programme only | Mandatory artist-led community station |
| Boxout FM | New Delhi, IN | [Official browser player](https://boxout.fm/radio) | None verified | Official recordings archive; no automated track extraction | Programme only | Mandatory South Asian independent-music platform |
| Cashmere Radio | Berlin, DE | [Official](https://cashmereradio.com/), 192k MP3 | Programme only | Official episode pages; archive labels are not tracks | Programme only | Mandatory experimental community station |
| **SomaFM CliqHop IDM** | US | [Official](https://somafm.com/cliqhop/), 128k MP3 | Track | `songs/cliqhop.json`, public JSON, timestamp cursor + stable source id | **~20 recent tracks, shallow** | Focused IDM and experimental electronics |
| **SomaFM Lush** | US | [Official](https://somafm.com/lush/), 128k MP3 | Track | `songs/lush.json`, public JSON, timestamp cursor + stable source id | **~20 recent tracks, shallow** | Dream-pop and vocal electronic specialist |
| **SomaFM Sonic Universe** | US | [Official](https://somafm.com/sonicuniverse/), 128k MP3 | Track | `songs/sonicuniverse.json`, public JSON, timestamp cursor + stable source id | **~20 recent tracks, shallow** | Modern and avant-garde jazz |
| **SomaFM Suburbs of Goa** | US | [Official](https://somafm.com/suburbsofgoa/), 128k MP3 | Track | `songs/suburbsofgoa.json`, public JSON, timestamp cursor + stable source id | **~20 recent tracks, shallow** | South Asian electronic and global fusion |
| dublab | Los Angeles, US | [Official](https://dublab.com/), 192k MP3 | None verified | Official schedule; no track extraction | Programme only | Long-running experimental broadcaster |
| Rinse FM | London, GB | [Official](https://rinse.fm/), 128k AAC+ | None verified | Official show archive; placeholder ICY rejected | Programme only | Foundational garage, grime, and club specialist |
| Worldwide FM | London, GB | [Official](https://worldwidefm.net/), 192k MP3 | Programme | Official schedule/archive; no inferred tracks | Programme only | Global selector radio |
| Refuge Worldwide | Berlin, DE | [Official](https://refugeworldwide.com/), 192k MP3 | Programme | Official schedule/archive; no inferred tracks | Programme only | Community radio centering underrepresented selectors |
| The Lot Radio | Brooklyn, US | [Official](https://www.thelotradio.com/), HLS AAC | Programme | Official schedule/archive; no inferred tracks | Programme only | Distinctive all-DJ live format |
| Radio Nopal | Mexico City, MX | [Official](https://radionopal.com/), MP3 | Track when ICY supplies a pair | ICY only | Live only | Independent Latin American perspective |
| NTS 1 | London, GB | [Official](https://www.nts.live/), 128k MP3 | Programme | Official dated episode archive; separate sanctioned archive ingestion | Deep programme archive | Essential left-field selector network |
| NTS 2 | London, GB | [Official](https://www.nts.live/), 128k MP3 | Programme | Official dated episode archive; separate sanctioned archive ingestion | Deep programme archive | Independently programmed second NTS channel |

The four bold SomaFM rows plus KEXP are the cohort’s five repeatable
track-history sources. Lore reads only SomaFM’s public JSON, preserves its epoch timestamp in both
`played_at` and the source identifier, filters strictly before the stored
cursor, deduplicates through the shared spin pipeline, and marks the source
exhausted when the rolling feed can provide nothing older. Empty or malformed
artist/title pairs and station IDs are discarded rather than reconstructed.

8Ball and Boxout intentionally use their official browser-player URLs because
no stable direct audio mount was published in the reviewed surface. They remain
honest playback-only records: Lore does not enroll a metadata poller or display
fabricated now-playing data for them.