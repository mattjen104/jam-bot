# Current Import Crossings Report

**Generated:** 2026-09-04 06:40 UTC  
**Data source:** Lore development database, queried in a `READ ONLY` transaction  
**Listener:** Lore user 1, resolved through the same `library_import_jobs.user_id → lore_users.id → library_items.user_id` ownership chain used by Lore sessions/imports  
**Import analyzed:** completed import **302**, Spotify, started 2026-07-31 18:36:15 UTC and finished 2026-07-31 18:36:40 UTC  
**Import boundary:** 3,495 source items; 1,903 resolved in that pass; **1,900 active Spotify-imported recording rows** at report time. Active unresolved Spotify staging artists were included for artist-level matching.  

> Note: no published production database exists for this Repl. The report therefore uses the current development dataset. Automated tests have also inserted visible fixture stations into that shared dataset; because the requirement is every non-hidden station, those fixtures remain in the complete tables rather than being silently excluded.

## Scope summary

| Scope | Ranked artists | Contributing stations | Total Crossings | Exact/library | Artist-level |
|---|---:|---:|---:|---:|---:|
| Now | 6 | 6 | 6 | 0 | 6 |
| Set | 88 | 74 | 179 | 3 | 176 |
| 24 hours | 177 | 113 | 700 | 22 | 678 |
| 7 days | 289 | 140 | 1,923 | 123 | 1,800 |
| Lifetime | 683 | 203 | 23,314 | 1,806 | 21,508 |

## Calculation notes

- **Exact/library** means the spun recording is an active imported MBID or shares its primary MusicBrainz release group with one.
- **Artist-level** means a different recording by an imported artist (MusicBrainz artist ID, with Lore’s normalized unresolved-Spotify-name fallback). Exact/release matches win, so the two contribution types never overlap.
- **Displayed total** is exact + artist-level, counted as distinct recording MBIDs per station, matching the standard 24-hour, 7-day, and Lifetime Crossing scope rules. Artist totals sum those station counts.
- **Now** uses each non-hidden station’s latest persisted spin when observed within Lore’s 60-minute live-pulse window.
- **Set** uses distinct matching recordings in the current live run (same station/show/day as its fresh latest spin).
- Categories follow Dial precedence exactly: Ambient → Campus → Specialist → Core → Public → Independent DJ → Discovery.
- Ties are deterministic: total descending, then artist name case-insensitively, then original artist spelling. Station ties use station name then slug.
- Removed library rows and hidden stations are excluded. The transaction ended with `ROLLBACK`; no listener or radio data was modified.

## Reconciliation against Lore’s existing Crossing cache

The cache was built on 2026-08-25 and covers the listener’s **entire** active taste set (1,900 imported recordings plus 29 keeps and taste seeds), while this report intentionally isolates only the current Spotify import and was generated ten days later. Exact equality is therefore not expected. Representative station totals nevertheless reconcile structurally: both use `exact + artist-level`, the report’s exact counts are close to the broader cache, and later rolling windows move as expected.

| Station | Source | 24h (E/A) | 7d (E/A) | Lifetime (E/A) |
|---|---|---:|---:|---:|
| KEXP | Current-import report | 17 (1/16) | 122 (6/116) | 7,722 (509/7,213) |
| KEXP | Existing whole-library cache | 20 (1/19) | 81 (5/76) | 7,802 (518/7,284) |
| BBC 6 Music | Current-import report | 7 (0/7) | 24 (2/22) | 166 (19/147) |
| BBC 6 Music | Existing whole-library cache | 6 (1/5) | 18 (2/16) | 136 (17/119) |
| FIP | Current-import report | 6 (0/6) | 14 (0/14) | 115 (20/95) |
| FIP | Existing whole-library cache | 9 (1/8) | 18 (1/17) | 85 (17/68) |

## Ranked tables

# Now

## Ambient

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | Britney Spears | **1** | 0 | 1 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 2 | Righteous Brothers | **1** | 0 | 1 | Candelight (`candelight`): **1** (0 exact / 1 artist) |

## Campus

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | The Cranberries | **1** | 0 | 1 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |

## Specialist

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | The Cure | **1** | 0 | 1 | New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (0 exact / 1 artist) |

## Core

_No Crossings._

## Public

_No Crossings._

## Independent DJ

_No Crossings._

## Discovery

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | Cars | **1** | 0 | 1 | Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (0 exact / 1 artist) |
| 2 | Neil Young | **1** | 0 | 1 | WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |

# Set

## Ambient

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | The Beatles | **3** | 0 | 3 | Candelight (`candelight`): **2** (0 exact / 2 artist)<br>- 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist) |
| 2 | Beach House | **2** | 0 | 2 | 181.FM - Chilled Out (USA) 128k mp3 (`181-fm-chilled-out-usa-128k-mp3`): **1** (0 exact / 1 artist)<br>Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 3 | Britney Spears | **2** | 0 | 2 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **2** (0 exact / 2 artist) |
| 4 | Beach Boys | **1** | 0 | 1 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 5 | Fleetwood Mac | **1** | 0 | 1 | Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 6 | Genesis | **1** | 0 | 1 | Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 7 | Jon Hopkins | **1** | 0 | 1 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist) |
| 8 | Kate Bush | **1** | 0 | 1 | Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 9 | Modest Mouse | **1** | 0 | 1 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 10 | Poliça | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 11 | Prince | **1** | 0 | 1 | Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 12 | Righteous Brothers | **1** | 0 | 1 | Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 13 | Tangerine Dream | **1** | 0 | 1 | Radio Caprice: Ambient (`radio-caprice-ambient`): **1** (0 exact / 1 artist) |
| 14 | The Beach Boys | **1** | 0 | 1 | Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 15 | Tim Hecker | **1** | 0 | 1 | ISEKOI Radio \| Non-Stop Ambient (`isekoi-radio-non-stop-ambient`): **1** (0 exact / 1 artist) |

## Campus

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | Dolly Parton | **5** | 0 | 5 | KXLU 88.9 FM (`kxlu`): **5** (0 exact / 5 artist) |
| 2 | Gorillaz | **2** | 0 | 2 | WMFO 91.5 FM (`wmfo`): **2** (0 exact / 2 artist) |
| 3 | Björk | **1** | 0 | 1 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 4 | Britney Spears | **1** | 0 | 1 | WBRS 100.1 FM (`wbrs`): **1** (0 exact / 1 artist) |
| 5 | Chelsea Wolfe | **1** | 0 | 1 | CJSR 88.5 FM (`cjsr`): **1** (0 exact / 1 artist) |
| 6 | Deftones | **1** | 0 | 1 | WBRS 100.1 FM (`wbrs`): **1** (0 exact / 1 artist) |
| 7 | Future Islands | **1** | 0 | 1 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist) |
| 8 | Holy Wave | **1** | 0 | 1 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist) |
| 9 | Kate Bush | **1** | 0 | 1 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 10 | Lady Gaga | **1** | 0 | 1 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 11 | Marvin Gaye | **1** | 0 | 1 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 12 | Max Cooper | **1** | 0 | 1 | WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 13 | MGMT | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 14 | Modest Mouse | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 15 | Nilüfer Yanya | **1** | 0 | 1 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 16 | Pile | **1** | 0 | 1 | WHRB 95.3 FM (`whrb`): **1** (0 exact / 1 artist) |
| 17 | Red Hot Chili Peppers | **1** | 0 | 1 | WICB 91.7 FM (`wicb`): **1** (0 exact / 1 artist) |
| 18 | The Cranberries | **1** | 0 | 1 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 19 | The Righteous Brothers | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 20 | The Voidz | **1** | 1 | 0 | WLUW 88.7 FM (`wluw`): **1** (1 exact / 0 artist) |
| 21 | Ween | **1** | 0 | 1 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |

## Specialist

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | Eurythmics | **5** | 0 | 5 | Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (0 exact / 1 artist)<br>New Wave Radio (`new-wave-radio`): **1** (0 exact / 1 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **1** (0 exact / 1 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **1** (0 exact / 1 artist) |
| 2 | Duran Duran | **4** | 0 | 4 | SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **2** (0 exact / 2 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (0 exact / 1 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **1** (0 exact / 1 artist) |
| 3 | Grateful Dead | **4** | 0 | 4 | Radio Caprice - Psychedelic Folk (`radio-caprice-psychedelic-folk`): **4** (0 exact / 4 artist) |
| 4 | Talking Heads | **4** | 0 | 4 | SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **2** (0 exact / 2 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (0 exact / 1 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **1** (0 exact / 1 artist) |
| 5 | The Beatles | **4** | 0 | 4 | 24-7 Psychedelic Rock (`24-7-psychedelic-rock`): **3** (0 exact / 3 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 6 | Pink Floyd | **3** | 0 | 3 | 24-7 Psychedelic Rock (`24-7-psychedelic-rock`): **3** (0 exact / 3 artist) |
| 7 | The Cure | **3** | 0 | 3 | 80's New Wave Radio (`80-s-new-wave-radio`): **1** (0 exact / 1 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (0 exact / 1 artist) |
| 8 | Castle Rat | **2** | 0 | 2 | SomaFM Metal Detector (128k AAC) (`somafm-metal-detector-128k-aac`): **1** (0 exact / 1 artist)<br>SomaFM Metal Detector (128k MP3) (`somafm-metal-detector-128k-mp3`): **1** (0 exact / 1 artist) |
| 9 | Hurray for the Riff Raff | **2** | 0 | 2 | SomaFM Folk Forward (128k AAC) (`somafm-folk-forward-128k-aac`): **1** (0 exact / 1 artist)<br>SomaFM Folk Forward (128k MP3) (`somafm-folk-forward-128k-mp3`): **1** (0 exact / 1 artist) |
| 10 | The Cars | **2** | 0 | 2 | GEM New Wave Radio (`gem-new-wave-radio`): **1** (0 exact / 1 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **1** (0 exact / 1 artist) |
| 11 | The Smiths | **2** | 0 | 2 | GEM New Wave Radio (`gem-new-wave-radio`): **1** (0 exact / 1 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **1** (0 exact / 1 artist) |
| 12 | Beatles | **1** | 0 | 1 | 24-7 Psychedelic Rock (`24-7-psychedelic-rock`): **1** (0 exact / 1 artist) |
| 13 | Björk | **1** | 0 | 1 | FIP Electro (`fip-electro`): **1** (0 exact / 1 artist) |
| 14 | Britney Spears | **1** | 0 | 1 | Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist) |
| 15 | Bronski Beat | **1** | 0 | 1 | New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (0 exact / 1 artist) |
| 16 | Cars | **1** | 0 | 1 | New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (0 exact / 1 artist) |
| 17 | David Bowie | **1** | 0 | 1 | New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (0 exact / 1 artist) |
| 18 | Depeche Mode | **1** | 0 | 1 | New Wave Radio (`new-wave-radio`): **1** (0 exact / 1 artist) |
| 19 | Ghost | **1** | 0 | 1 | Radio Caprice - Psychedelic Folk (`radio-caprice-psychedelic-folk`): **1** (0 exact / 1 artist) |
| 20 | Gong | **1** | 0 | 1 | FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 21 | Jimi Hendrix | **1** | 0 | 1 | 24-7 Psychedelic Rock (`24-7-psychedelic-rock`): **1** (0 exact / 1 artist) |
| 22 | Marvin Gaye | **1** | 0 | 1 | Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist) |
| 23 | Missing Persons | **1** | 0 | 1 | 80's New Wave Radio (`80-s-new-wave-radio`): **1** (0 exact / 1 artist) |
| 24 | Nirvana | **1** | 0 | 1 | FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 25 | Peter Gabriel | **1** | 0 | 1 | 80's New Wave Radio (`80-s-new-wave-radio`): **1** (0 exact / 1 artist) |
| 26 | Phil Collins | **1** | 0 | 1 | 80s Alive (`80s-alive`): **1** (0 exact / 1 artist) |
| 27 | Prince | **1** | 0 | 1 | Worldwide FM (`worldwide-fm`): **1** (0 exact / 1 artist) |
| 28 | R.E.M. | **1** | 0 | 1 | 80's New Wave Radio (`80-s-new-wave-radio`): **1** (0 exact / 1 artist) |
| 29 | Tears For Fears | **1** | 0 | 1 | New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (0 exact / 1 artist) |
| 30 | Tears for Fears | **1** | 0 | 1 | 80's New Wave Radio (`80-s-new-wave-radio`): **1** (0 exact / 1 artist) |
| 31 | Thomas Fehlmann | **1** | 0 | 1 | SomaFM — CliqHop IDM (`somafm-cliqhop`): **1** (0 exact / 1 artist) |
| 32 | Tony Allen | **1** | 0 | 1 | FIP World (`fip-world`): **1** (0 exact / 1 artist) |
| 33 | Waveshaper | **1** | 0 | 1 | Nightride FM — Chillsynth (`nightride-chillsynth`): **1** (0 exact / 1 artist) |

## Core

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | Mulatu Astatke | **1** | 0 | 1 | FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 2 | The Divine Comedy | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |

## Public

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | Al Di Meola | **1** | 0 | 1 | CKUA Radio (`ckua`): **1** (0 exact / 1 artist) |

## Independent DJ

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | Sigur Rós | **2** | 0 | 2 | Championshipvinyl (`championshipvinyl`): **2** (0 exact / 2 artist) |
| 2 | Tears For Fears | **2** | 0 | 2 | Championshipvinyl (`championshipvinyl`): **2** (0 exact / 2 artist) |
| 3 | The Beatles | **2** | 0 | 2 | Championshipvinyl (`championshipvinyl`): **1** (0 exact / 1 artist)<br>Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 4 | Chaka Khan | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 5 | David Bowie | **1** | 0 | 1 | Championshipvinyl (`championshipvinyl`): **1** (0 exact / 1 artist) |
| 6 | Everything Everything | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 7 | Future Islands | **1** | 0 | 1 | Championshipvinyl (`championshipvinyl`): **1** (0 exact / 1 artist) |
| 8 | Kate Bush | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 9 | Morrissey | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 10 | Nina Simone | **1** | 0 | 1 | Championshipvinyl (`championshipvinyl`): **1** (0 exact / 1 artist) |
| 11 | Peter Gabriel | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 12 | R.E.M. | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 13 | The Blue Nile | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 14 | The Cure | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |

## Discovery

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | Depeche Mode | **5** | 0 | 5 | Synthradio (`synthradio`): **3** (0 exact / 3 artist)<br>Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist) |
| 2 | Gong | **3** | 0 | 3 | Avant-Prog/Rock in Opposition/Canterbury Scene/Zeuhl - Radio Caprice (`avant-prog-rock-in-opposition-canterbury-scene-zeuhl-radio-caprice`): **3** (0 exact / 3 artist) |
| 3 | THE ALAN PARSONS PROJECT | **3** | 0 | 3 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 4 | Bronski Beat | **2** | 0 | 2 | Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (0 exact / 1 artist)<br>Radio Mela (`radio-mela`): **1** (0 exact / 1 artist) |
| 5 | Cars | **2** | 0 | 2 | Big R Radio - The Wave (`big-r-radio-the-wave`): **2** (0 exact / 2 artist) |
| 6 | Chaka Khan | **2** | 0 | 2 | C Lab (`c-lab`): **1** (0 exact / 1 artist)<br>RMC Nights Story (`rmc-nights-story`): **1** (0 exact / 1 artist) |
| 7 | Duran Duran | **2** | 0 | 2 | Big R Radio - The Wave (`big-r-radio-the-wave`): **2** (0 exact / 2 artist) |
| 8 | Marvin Gaye | **2** | 0 | 2 | Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 9 | MAXWELL | **2** | 0 | 2 | Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 10 | Neil Young | **2** | 0 | 2 | RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 11 | Björk | **1** | 0 | 1 | RMC Nights Story (`rmc-nights-story`): **1** (0 exact / 1 artist) |
| 12 | Bone Thugs‐n‐Harmony | **1** | 0 | 1 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist) |
| 13 | Brian Jonestown Massacre | **1** | 0 | 1 | DKFM Classic (`dkfm-classic`): **1** (0 exact / 1 artist) |
| 14 | Galaxie 500 | **1** | 0 | 1 | DKFM Classic (`dkfm-classic`): **1** (0 exact / 1 artist) |
| 15 | Gorillaz | **1** | 0 | 1 | i love radio - greatest hits (`i-love-radio-greatest-hits`): **1** (0 exact / 1 artist) |
| 16 | Grateful Dead | **1** | 0 | 1 | WPKN 89.5 FM (`wpkn`): **1** (0 exact / 1 artist) |
| 17 | Khruangbin | **1** | 0 | 1 | WBEZ-HD2 "Vocalo Stream" Chicago, IL (`wbez-hd2-vocalo-stream-chicago-il`): **1** (0 exact / 1 artist) |
| 18 | KOKOROKO | **1** | 1 | 0 | Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **1** (1 exact / 0 artist) |
| 19 | LADY GAGA | **1** | 0 | 1 | i love radio - greatest hits (`i-love-radio-greatest-hits`): **1** (0 exact / 1 artist) |
| 20 | Lady Gaga | **1** | 0 | 1 | ..87,5!. Nantes (`87-5-nantes`): **1** (0 exact / 1 artist) |
| 21 | Low | **1** | 0 | 1 | 6forty Radio (`6forty-radio`): **1** (0 exact / 1 artist) |
| 22 | Maxwell | **1** | 0 | 1 | RMC Nights Story (`rmc-nights-story`): **1** (0 exact / 1 artist) |
| 23 | MGMT | **1** | 0 | 1 | i love radio - greatest hits (`i-love-radio-greatest-hits`): **1** (0 exact / 1 artist) |
| 24 | Momma | **1** | 0 | 1 | WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 25 | Oneohtrix Point Never | **1** | 0 | 1 | Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **1** (0 exact / 1 artist) |
| 26 | Peter Gabriel | **1** | 0 | 1 | RMC Voyage Voyage (`rmc-voyage-voyage`): **1** (0 exact / 1 artist) |
| 27 | Pink Floyd | **1** | 0 | 1 | Heavy Music Atmospheric Radio (`heavy-music-atmospheric-radio`): **1** (0 exact / 1 artist) |
| 28 | Prince | **1** | 0 | 1 | RMC Voyage Voyage (`rmc-voyage-voyage`): **1** (0 exact / 1 artist) |
| 29 | Queen | **1** | 0 | 1 | Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist) |
| 30 | Rothko | **1** | 0 | 1 | Radio Caprice - Post-rock (`radio-caprice-post-rock`): **1** (0 exact / 1 artist) |
| 31 | Talking Heads | **1** | 0 | 1 | Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (0 exact / 1 artist) |
| 32 | Tangerine Dream | **1** | 0 | 1 | Radio Caprice - Krautrock (`radio-caprice-krautrock`): **1** (0 exact / 1 artist) |
| 33 | Tears For Fears | **1** | 0 | 1 | Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (0 exact / 1 artist) |
| 34 | Teddy Swims | **1** | 0 | 1 | MFM STATION (`mfm-station`): **1** (0 exact / 1 artist) |
| 35 | The Beach Boys | **1** | 0 | 1 | Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist) |
| 36 | The Beatles | **1** | 0 | 1 | Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist) |
| 37 | The Brian Jonestown Massacre | **1** | 0 | 1 | DKFM Classic (`dkfm-classic`): **1** (0 exact / 1 artist) |
| 38 | The Cure | **1** | 0 | 1 | Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (0 exact / 1 artist) |
| 39 | Thievery Corporation | **1** | 0 | 1 | SWISS GROOVE (`swiss-groove`): **1** (0 exact / 1 artist) |
| 40 | This Will Destroy You | **1** | 0 | 1 | Radio Caprice - Post-rock (`radio-caprice-post-rock`): **1** (0 exact / 1 artist) |
| 41 | Trentemøller | **1** | 0 | 1 | dinamo.fm smog (`dinamo-fm-smog`): **1** (0 exact / 1 artist) |
| 42 | Viagra Boys | **1** | 1 | 0 | WPKN 89.5 FM (`wpkn`): **1** (1 exact / 0 artist) |

# 24 hours

## Ambient

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | Phil Collins | **6** | 0 | 6 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **3** (0 exact / 3 artist)<br>Candelight (`candelight`): **3** (0 exact / 3 artist) |
| 2 | Queen | **6** | 0 | 6 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **5** (0 exact / 5 artist)<br>- 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist) |
| 3 | The Beatles | **6** | 0 | 6 | Candelight (`candelight`): **3** (0 exact / 3 artist)<br>- 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **2** (0 exact / 2 artist)<br>Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 4 | Tim Hecker | **5** | 0 | 5 | ISEKOI Radio \| Non-Stop Ambient (`isekoi-radio-non-stop-ambient`): **4** (0 exact / 4 artist)<br>SomaFM Mission Control (128k MP3) (`somafm-mission-control-128k-mp3`): **1** (0 exact / 1 artist) |
| 5 | Oneohtrix Point Never | **4** | 0 | 4 | ISEKOI Radio \| Non-Stop Ambient (`isekoi-radio-non-stop-ambient`): **4** (0 exact / 4 artist) |
| 6 | Beach House | **3** | 0 | 3 | 181.FM - Chilled Out (USA) 128k mp3 (`181-fm-chilled-out-usa-128k-mp3`): **2** (0 exact / 2 artist)<br>Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 7 | Fleetwood Mac | **3** | 0 | 3 | Candelight (`candelight`): **3** (0 exact / 3 artist) |
| 8 | Genesis | **3** | 0 | 3 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **2** (0 exact / 2 artist)<br>Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 9 | Jon Hopkins | **3** | 0 | 3 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist)<br>Radio Caprice: Ambient (`radio-caprice-ambient`): **1** (0 exact / 1 artist)<br>SomaFM SF 10-33 (128k MP3) (`somafm-sf-10-33-128k-mp3`): **1** (0 exact / 1 artist) |
| 10 | Prince | **3** | 0 | 3 | 100% ACID JAZZ (`100-acid-jazz`): **2** (0 exact / 2 artist)<br>Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 11 | Tears For Fears | **3** | 0 | 3 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **2** (0 exact / 2 artist)<br>Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 12 | Britney Spears | **2** | 0 | 2 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **2** (0 exact / 2 artist) |
| 13 | R.E.M. | **2** | 0 | 2 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **2** (0 exact / 2 artist) |
| 14 | Surprise Chef | **2** | 2 | 0 | NEU RADIO (`neu-radio`): **2** (2 exact / 0 artist) |
| 15 | Tangerine Dream | **2** | 0 | 2 | Radio Caprice: Ambient (`radio-caprice-ambient`): **2** (0 exact / 2 artist) |
| 16 | The Beach Boys | **2** | 0 | 2 | Candelight (`candelight`): **1** (0 exact / 1 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist) |
| 17 | Beach Boys | **1** | 0 | 1 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 18 | Billy Joel | **1** | 0 | 1 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist) |
| 19 | Bob Marley & The Wailers | **1** | 0 | 1 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 20 | Bronski Beat | **1** | 0 | 1 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 21 | Clark | **1** | 0 | 1 | SomaFM SF 10-33 (128k MP3) (`somafm-sf-10-33-128k-mp3`): **1** (0 exact / 1 artist) |
| 22 | Deathprod | **1** | 1 | 0 | RADCAP: INDUSTRIAL / DARK / RITUAL AMBIENT (`radcap-industrial-dark-ritual-ambient`): **1** (1 exact / 0 artist) |
| 23 | Depeche Mode | **1** | 0 | 1 | 181.FM - Chilled Out (USA) 128k mp3 (`181-fm-chilled-out-usa-128k-mp3`): **1** (0 exact / 1 artist) |
| 24 | Floating Points | **1** | 0 | 1 | SomaFM SF 10-33 (128k MP3) (`somafm-sf-10-33-128k-mp3`): **1** (0 exact / 1 artist) |
| 25 | Gorillaz | **1** | 0 | 1 | 181.FM - Chilled Out (USA) 128k mp3 (`181-fm-chilled-out-usa-128k-mp3`): **1** (0 exact / 1 artist) |
| 26 | Journey | **1** | 0 | 1 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist) |
| 27 | Kate Bush | **1** | 0 | 1 | Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 28 | Marvin Gaye | **1** | 0 | 1 | Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 29 | Max Cooper | **1** | 0 | 1 | SomaFM DEF CON Radio (128k AAC) (`somafm-def-con-radio-128k-aac`): **1** (0 exact / 1 artist) |
| 30 | Modest Mouse | **1** | 0 | 1 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 31 | Murcof | **1** | 0 | 1 | SomaFM SF 10-33 (128k MP3) (`somafm-sf-10-33-128k-mp3`): **1** (0 exact / 1 artist) |
| 32 | Nathan Fake | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 33 | Paul McCartney | **1** | 0 | 1 | Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 34 | Poliça | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 35 | Righteous Brothers | **1** | 0 | 1 | Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 36 | Rothko | **1** | 0 | 1 | Culture Failure (`culture-failure`): **1** (0 exact / 1 artist) |
| 37 | Sofie Birch | **1** | 0 | 1 | ISEKOI Radio \| Non-Stop Ambient (`isekoi-radio-non-stop-ambient`): **1** (0 exact / 1 artist) |
| 38 | The Alan Parsons Project | **1** | 0 | 1 | Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 39 | The Cure | **1** | 0 | 1 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 40 | Thievery Corporation | **1** | 0 | 1 | Groove Wave Lounge (`groove-wave-lounge`): **1** (0 exact / 1 artist) |
| 41 | Tiffany | **1** | 0 | 1 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist) |

## Campus

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | Dolly Parton | **23** | 0 | 23 | KALX 90.7 FM (`kalx`): **6** (0 exact / 6 artist)<br>WMFO 91.5 FM (`wmfo`): **6** (0 exact / 6 artist)<br>KXLU 88.9 FM (`kxlu`): **5** (0 exact / 5 artist)<br>WPRB 103.3 FM (`wprb`): **5** (0 exact / 5 artist)<br>WXYC 89.3 FM (`wxyc`): **1** (0 exact / 1 artist) |
| 2 | Gorillaz | **4** | 0 | 4 | WMFO 91.5 FM (`wmfo`): **4** (0 exact / 4 artist) |
| 3 | The Beatles | **4** | 0 | 4 | WMFO 91.5 FM (`wmfo`): **4** (0 exact / 4 artist) |
| 4 | Depeche Mode | **2** | 0 | 2 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **2** (0 exact / 2 artist) |
| 5 | Fleetwood Mac | **2** | 0 | 2 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist)<br>WXYC 89.3 FM (`wxyc`): **1** (0 exact / 1 artist) |
| 6 | Kate Bush | **2** | 0 | 2 | WMFO 91.5 FM (`wmfo`): **2** (0 exact / 2 artist) |
| 7 | MGMT | **2** | 0 | 2 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 8 | Modest Mouse | **2** | 1 | 1 | KVSC 88.1 FM (`kvsc`): **1** (1 exact / 0 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 9 | Morrissey | **2** | 0 | 2 | WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 10 | Neil Young | **2** | 0 | 2 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 11 | R.E.M. | **2** | 0 | 2 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 12 | The Cranberries | **2** | 0 | 2 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 13 | Björk | **1** | 0 | 1 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 14 | Britney Spears | **1** | 0 | 1 | WBRS 100.1 FM (`wbrs`): **1** (0 exact / 1 artist) |
| 15 | Chelsea Wolfe | **1** | 0 | 1 | CJSR 88.5 FM (`cjsr`): **1** (0 exact / 1 artist) |
| 16 | Crosby, Stills, Nash & Young | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 17 | David Bowie | **1** | 0 | 1 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 18 | Deerhoof | **1** | 0 | 1 | WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 19 | Deftones | **1** | 0 | 1 | WBRS 100.1 FM (`wbrs`): **1** (0 exact / 1 artist) |
| 20 | Duran Duran | **1** | 0 | 1 | WXYC 89.3 FM (`wxyc`): **1** (0 exact / 1 artist) |
| 21 | Foo Fighters | **1** | 0 | 1 | WICB 91.7 FM (`wicb`): **1** (0 exact / 1 artist) |
| 22 | Future Islands | **1** | 0 | 1 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist) |
| 23 | Holy Wave | **1** | 0 | 1 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist) |
| 24 | Jim Croce | **1** | 0 | 1 | KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist) |
| 25 | Kraftwerk | **1** | 0 | 1 | WXYC 89.3 FM (`wxyc`): **1** (0 exact / 1 artist) |
| 26 | Lady Gaga | **1** | 0 | 1 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 27 | Lusine | **1** | 1 | 0 | WXYC 89.3 FM (`wxyc`): **1** (1 exact / 0 artist) |
| 28 | Marvin Gaye | **1** | 0 | 1 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 29 | Max Cooper | **1** | 0 | 1 | WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 30 | Momma | **1** | 0 | 1 | WXYC 89.3 FM (`wxyc`): **1** (0 exact / 1 artist) |
| 31 | Nilüfer Yanya | **1** | 0 | 1 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 32 | Oneohtrix Point Never | **1** | 0 | 1 | KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist) |
| 33 | Pile | **1** | 0 | 1 | WHRB 95.3 FM (`whrb`): **1** (0 exact / 1 artist) |
| 34 | Queen | **1** | 0 | 1 | WICB 91.7 FM (`wicb`): **1** (0 exact / 1 artist) |
| 35 | Red Hot Chili Peppers | **1** | 0 | 1 | WICB 91.7 FM (`wicb`): **1** (0 exact / 1 artist) |
| 36 | Soul Coughing | **1** | 0 | 1 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist) |
| 37 | Steely Dan | **1** | 0 | 1 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 38 | Talking Heads | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 39 | The Brian Jonestown Massacre | **1** | 0 | 1 | WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 40 | The Righteous Brothers | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 41 | The Smashing Pumpkins | **1** | 0 | 1 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist) |
| 42 | The Smiths | **1** | 0 | 1 | WXYC 89.3 FM (`wxyc`): **1** (0 exact / 1 artist) |
| 43 | The Voidz | **1** | 1 | 0 | WLUW 88.7 FM (`wluw`): **1** (1 exact / 0 artist) |
| 44 | Trans Am | **1** | 0 | 1 | WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 45 | Ween | **1** | 0 | 1 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |

## Specialist

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | Depeche Mode | **12** | 0 | 12 | New Wave Radio (`new-wave-radio`): **3** (0 exact / 3 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **2** (0 exact / 2 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **2** (0 exact / 2 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **1** (0 exact / 1 artist)<br>FIP Electro (`fip-electro`): **1** (0 exact / 1 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **1** (0 exact / 1 artist)<br>KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **1** (0 exact / 1 artist) |
| 2 | Eurythmics | **10** | 0 | 10 | SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **3** (0 exact / 3 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **3** (0 exact / 3 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **1** (0 exact / 1 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (0 exact / 1 artist)<br>New Wave Radio (`new-wave-radio`): **1** (0 exact / 1 artist) |
| 3 | Grateful Dead | **9** | 0 | 9 | Radio Caprice - Psychedelic Folk (`radio-caprice-psychedelic-folk`): **8** (0 exact / 8 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 4 | Pink Floyd | **8** | 0 | 8 | 24-7 Psychedelic Rock (`24-7-psychedelic-rock`): **7** (0 exact / 7 artist)<br>KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 5 | Talking Heads | **8** | 0 | 8 | SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **2** (0 exact / 2 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **1** (0 exact / 1 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist)<br>KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (0 exact / 1 artist)<br>New Wave Radio (`new-wave-radio`): **1** (0 exact / 1 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **1** (0 exact / 1 artist) |
| 6 | The Cars | **8** | 0 | 8 | GEM New Wave Radio (`gem-new-wave-radio`): **2** (0 exact / 2 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **2** (0 exact / 2 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **2** (0 exact / 2 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **1** (0 exact / 1 artist)<br>New Wave Radio (`new-wave-radio`): **1** (0 exact / 1 artist) |
| 7 | The Cure | **8** | 0 | 8 | New Wave Radio (`new-wave-radio`): **4** (0 exact / 4 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **1** (0 exact / 1 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (0 exact / 1 artist) |
| 8 | Duran Duran | **7** | 0 | 7 | New Wave - BestNet Radio (`new-wave-bestnet-radio`): **2** (0 exact / 2 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **2** (0 exact / 2 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **1** (0 exact / 1 artist)<br>New Wave Radio (`new-wave-radio`): **1** (0 exact / 1 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **1** (0 exact / 1 artist) |
| 9 | R.E.M. | **7** | 0 | 7 | 80's New Wave Radio (`80-s-new-wave-radio`): **2** (0 exact / 2 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **2** (0 exact / 2 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **1** (0 exact / 1 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist) |
| 10 | The Beatles | **6** | 0 | 6 | 24-7 Psychedelic Rock (`24-7-psychedelic-rock`): **5** (0 exact / 5 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 11 | David Bowie | **5** | 0 | 5 | GEM New Wave Radio (`gem-new-wave-radio`): **1** (0 exact / 1 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **1** (0 exact / 1 artist)<br>Gen X Radio (`gen-x-radio`): **1** (0 exact / 1 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (0 exact / 1 artist)<br>New Wave Radio (`new-wave-radio`): **1** (0 exact / 1 artist) |
| 12 | Missing Persons | **5** | 2 | 3 | SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **2** (1 exact / 1 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **2** (1 exact / 1 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **1** (0 exact / 1 artist) |
| 13 | Fleetwood Mac | **4** | 0 | 4 | Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **2** (0 exact / 2 artist)<br>All Oldies Channel (`all-oldies-channel`): **1** (0 exact / 1 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 14 | Jimi Hendrix | **4** | 0 | 4 | 24-7 Psychedelic Rock (`24-7-psychedelic-rock`): **3** (0 exact / 3 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 15 | Nirvana | **4** | 0 | 4 | KEXP 90.3 FM (`kexp`): **3** (0 exact / 3 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 16 | The Smiths | **4** | 0 | 4 | GEM New Wave Radio (`gem-new-wave-radio`): **2** (0 exact / 2 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **1** (0 exact / 1 artist) |
| 17 | Beatles | **3** | 0 | 3 | 24-7 Psychedelic Rock (`24-7-psychedelic-rock`): **3** (0 exact / 3 artist) |
| 18 | Billy Idol | **3** | 0 | 3 | New Wave Radio (`new-wave-radio`): **1** (0 exact / 1 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **1** (0 exact / 1 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **1** (0 exact / 1 artist) |
| 19 | Prince | **3** | 0 | 3 | Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **2** (0 exact / 2 artist)<br>Worldwide FM (`worldwide-fm`): **1** (0 exact / 1 artist) |
| 20 | Bauhaus | **2** | 0 | 2 | GEM New Wave Radio (`gem-new-wave-radio`): **1** (0 exact / 1 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **1** (0 exact / 1 artist) |
| 21 | Cars | **2** | 0 | 2 | New Wave - BestNet Radio (`new-wave-bestnet-radio`): **2** (0 exact / 2 artist) |
| 22 | Castle Rat | **2** | 0 | 2 | SomaFM Metal Detector (128k AAC) (`somafm-metal-detector-128k-aac`): **1** (0 exact / 1 artist)<br>SomaFM Metal Detector (128k MP3) (`somafm-metal-detector-128k-mp3`): **1** (0 exact / 1 artist) |
| 23 | Ghost | **2** | 0 | 2 | Radio Caprice - Psychedelic Folk (`radio-caprice-psychedelic-folk`): **2** (0 exact / 2 artist) |
| 24 | Hurray for the Riff Raff | **2** | 0 | 2 | SomaFM Folk Forward (128k AAC) (`somafm-folk-forward-128k-aac`): **1** (0 exact / 1 artist)<br>SomaFM Folk Forward (128k MP3) (`somafm-folk-forward-128k-mp3`): **1** (0 exact / 1 artist) |
| 25 | Kate Bush | **2** | 0 | 2 | Gem Radio New Wave (`gem-radio-new-wave`): **1** (0 exact / 1 artist)<br>SomaFM — Lush (`somafm-lush`): **1** (0 exact / 1 artist) |
| 26 | Max Cooper | **2** | 0 | 2 | Radio Caprice - Experimental Techno [2] (`radio-caprice-experimental-techno-2`): **1** (0 exact / 1 artist)<br>SomaFM — CliqHop IDM (`somafm-cliqhop`): **1** (0 exact / 1 artist) |
| 27 | Poliça | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist)<br>SomaFM — Lush (`somafm-lush`): **1** (0 exact / 1 artist) |
| 28 | Tears For Fears | **2** | 0 | 2 | New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (0 exact / 1 artist)<br>New Wave Radio (`new-wave-radio`): **1** (0 exact / 1 artist) |
| 29 | Tears for Fears | **2** | 0 | 2 | 80's New Wave Radio (`80-s-new-wave-radio`): **1** (0 exact / 1 artist)<br>80s Alive (`80s-alive`): **1** (0 exact / 1 artist) |
| 30 | The The | **2** | 0 | 2 | GEM New Wave Radio (`gem-new-wave-radio`): **1** (0 exact / 1 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **1** (0 exact / 1 artist) |
| 31 | Tim Hecker | **2** | 0 | 2 | RADCAP: DRONE AMBIENT (`radcap-drone-ambient`): **2** (0 exact / 2 artist) |
| 32 | Woods | **2** | 0 | 2 | Radio Caprice - Psychedelic Folk (`radio-caprice-psychedelic-folk`): **2** (0 exact / 2 artist) |
| 33 | Altın Gün | **1** | 0 | 1 | FIP World (`fip-world`): **1** (0 exact / 1 artist) |
| 34 | Bananarama | **1** | 0 | 1 | 80's New Wave Radio (`80-s-new-wave-radio`): **1** (0 exact / 1 artist) |
| 35 | Björk | **1** | 0 | 1 | FIP Electro (`fip-electro`): **1** (0 exact / 1 artist) |
| 36 | Britney Spears | **1** | 0 | 1 | Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist) |
| 37 | Bronski Beat | **1** | 0 | 1 | New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (0 exact / 1 artist) |
| 38 | Bruce Hornsby | **1** | 0 | 1 | Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist) |
| 39 | Chelsea Wolfe | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 40 | Chinese American Bear | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 41 | Dave Matthews Band | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 42 | Die Spitz | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 43 | Dolly Parton | **1** | 0 | 1 | Gen X Radio (`gen-x-radio`): **1** (0 exact / 1 artist) |
| 44 | Eagles | **1** | 1 | 0 | FIP Rock (`fip-rock`): **1** (1 exact / 0 artist) |
| 45 | Ecce Shnak | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 46 | Glen Campbell | **1** | 1 | 0 | Gen X Radio (`gen-x-radio`): **1** (1 exact / 0 artist) |
| 47 | Gong | **1** | 0 | 1 | FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 48 | Guns N’ Roses | **1** | 0 | 1 | 80s Alive (`80s-alive`): **1** (0 exact / 1 artist) |
| 49 | Jodeci | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 50 | Kikagaku Moyo | **1** | 0 | 1 | FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 51 | Kraftwerk | **1** | 0 | 1 | 80's New Wave Radio (`80-s-new-wave-radio`): **1** (0 exact / 1 artist) |
| 52 | Marvin Gaye | **1** | 0 | 1 | Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist) |
| 53 | MJ Lenderman | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 54 | Nancy Sinatra | **1** | 0 | 1 | FIP Jazz (`fip-jazz`): **1** (0 exact / 1 artist) |
| 55 | Oneohtrix Point Never | **1** | 0 | 1 | RADCAP: DRONE AMBIENT (`radcap-drone-ambient`): **1** (0 exact / 1 artist) |
| 56 | Peter Gabriel | **1** | 0 | 1 | 80's New Wave Radio (`80-s-new-wave-radio`): **1** (0 exact / 1 artist) |
| 57 | Peter Schilling | **1** | 1 | 0 | 80's New Wave Radio (`80-s-new-wave-radio`): **1** (1 exact / 0 artist) |
| 58 | Phil Collins | **1** | 0 | 1 | 80s Alive (`80s-alive`): **1** (0 exact / 1 artist) |
| 59 | Queen | **1** | 0 | 1 | All Oldies Channel (`all-oldies-channel`): **1** (0 exact / 1 artist) |
| 60 | Rush | **1** | 0 | 1 | 80s Alive (`80s-alive`): **1** (0 exact / 1 artist) |
| 61 | Sigur Rós | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 62 | Steely Dan | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 63 | Surprise Chef | **1** | 0 | 1 | Worldwide FM (`worldwide-fm`): **1** (0 exact / 1 artist) |
| 64 | The Band | **1** | 0 | 1 | Radio Caprice - Psychedelic Folk (`radio-caprice-psychedelic-folk`): **1** (0 exact / 1 artist) |
| 65 | The Black Dog | **1** | 0 | 1 | Radio Caprice - Experimental Techno [2] (`radio-caprice-experimental-techno-2`): **1** (0 exact / 1 artist) |
| 66 | The Observers | **1** | 0 | 1 | FIP Reggae (`fip-reggae`): **1** (0 exact / 1 artist) |
| 67 | The Sisters of Mercy | **1** | 0 | 1 | New Wave Radio (`new-wave-radio`): **1** (0 exact / 1 artist) |
| 68 | Thievery Corporation | **1** | 0 | 1 | SomaFM — Suburbs of Goa (`somafm-suburbsofgoa`): **1** (0 exact / 1 artist) |
| 69 | Thomas Fehlmann | **1** | 0 | 1 | SomaFM — CliqHop IDM (`somafm-cliqhop`): **1** (0 exact / 1 artist) |
| 70 | Tony Allen | **1** | 0 | 1 | FIP World (`fip-world`): **1** (0 exact / 1 artist) |
| 71 | Turnstile | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 72 | Ulver | **1** | 0 | 1 | RADCAP: DRONE AMBIENT (`radcap-drone-ambient`): **1** (0 exact / 1 artist) |
| 73 | Waveshaper | **1** | 0 | 1 | Nightride FM — Chillsynth (`nightride-chillsynth`): **1** (0 exact / 1 artist) |

## Core

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | Chinese American Bear | **2** | 0 | 2 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 2 | David Bowie | **2** | 0 | 2 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 3 | Prince | **2** | 0 | 2 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist)<br>FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 4 | Dolly Parton | **1** | 0 | 1 | FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 5 | Future Islands | **1** | 0 | 1 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 6 | Holy Wave | **1** | 0 | 1 | KUTX 98.9 FM (`kutx`): **1** (0 exact / 1 artist) |
| 7 | Juana Molina | **1** | 0 | 1 | FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 8 | Kikagaku Moyo | **1** | 0 | 1 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 9 | KOKOROKO | **1** | 0 | 1 | FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 10 | Marvin Gaye | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 11 | Maxwell | **1** | 0 | 1 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 12 | Modest Mouse | **1** | 0 | 1 | KUTX 98.9 FM (`kutx`): **1** (0 exact / 1 artist) |
| 13 | Mulatu Astatke | **1** | 0 | 1 | FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 14 | Patsy Cline | **1** | 0 | 1 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 15 | Peter Gabriel | **1** | 0 | 1 | KUTX 98.9 FM (`kutx`): **1** (0 exact / 1 artist) |
| 16 | Talking Heads | **1** | 0 | 1 | FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 17 | The Beatles | **1** | 0 | 1 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 18 | The Divine Comedy | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 19 | The Smiths | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 20 | Thievery Corporation | **1** | 0 | 1 | KUTX 98.9 FM (`kutx`): **1** (0 exact / 1 artist) |
| 21 | Turnstile | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |

## Public

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | Al Di Meola | **1** | 0 | 1 | CKUA Radio (`ckua`): **1** (0 exact / 1 artist) |
| 2 | Dolly Parton | **1** | 0 | 1 | CKUA Radio (`ckua`): **1** (0 exact / 1 artist) |
| 3 | R.E.M. | **1** | 0 | 1 | CKUA Radio (`ckua`): **1** (0 exact / 1 artist) |

## Independent DJ

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | David Bowie | **3** | 0 | 3 | Championshipvinyl (`championshipvinyl`): **3** (0 exact / 3 artist) |
| 2 | Future Islands | **3** | 0 | 3 | Championshipvinyl (`championshipvinyl`): **2** (0 exact / 2 artist)<br>Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 3 | The Smiths | **3** | 0 | 3 | Championshipvinyl (`championshipvinyl`): **2** (0 exact / 2 artist)<br>HEADY (`heady`): **1** (0 exact / 1 artist) |
| 4 | Turnstile | **3** | 0 | 3 | HEADY (`heady`): **3** (0 exact / 3 artist) |
| 5 | Foo Fighters | **2** | 0 | 2 | Championshipvinyl (`championshipvinyl`): **2** (0 exact / 2 artist) |
| 6 | Pink Floyd | **2** | 0 | 2 | Championshipvinyl (`championshipvinyl`): **1** (0 exact / 1 artist)<br>Path through the Forest (`path-through-the-forest`): **1** (0 exact / 1 artist) |
| 7 | Prince | **2** | 0 | 2 | Yammat FM (`yammat-fm`): **2** (0 exact / 2 artist) |
| 8 | R.E.M. | **2** | 0 | 2 | Super45.fm (`super45-fm`): **2** (0 exact / 2 artist) |
| 9 | Sigur Rós | **2** | 0 | 2 | Championshipvinyl (`championshipvinyl`): **2** (0 exact / 2 artist) |
| 10 | Talking Heads | **2** | 0 | 2 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist)<br>Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 11 | Tears For Fears | **2** | 0 | 2 | Championshipvinyl (`championshipvinyl`): **2** (0 exact / 2 artist) |
| 12 | The Beatles | **2** | 0 | 2 | Championshipvinyl (`championshipvinyl`): **1** (0 exact / 1 artist)<br>Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 13 | The Cure | **2** | 0 | 2 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist)<br>Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 14 | Arc De Soleil | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 15 | Bananarama | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 16 | Beach Fossils | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 17 | Broadcast | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 18 | Chaka Khan | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 19 | Creedence Clearwater Revival | **1** | 0 | 1 | Path through the Forest (`path-through-the-forest`): **1** (0 exact / 1 artist) |
| 20 | Deftones | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 21 | Depeche Mode | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 22 | Everything Everything | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 23 | Fuzz | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 24 | Gorillaz | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 25 | Hole | **1** | 0 | 1 | Path through the Forest (`path-through-the-forest`): **1** (0 exact / 1 artist) |
| 26 | John Maus | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 27 | Juana Molina | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 28 | Kate Bush | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 29 | Khruangbin | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 30 | Kraftwerk | **1** | 0 | 1 | Path through the Forest (`path-through-the-forest`): **1** (0 exact / 1 artist) |
| 31 | Modest Mouse | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 32 | Morrissey | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 33 | Nina Simone | **1** | 0 | 1 | Championshipvinyl (`championshipvinyl`): **1** (0 exact / 1 artist) |
| 34 | Paul McCartney | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 35 | Peter Gabriel | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 36 | Protomartyr | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 37 | Psychedelic Porn Crumpets | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 38 | Red Hot Chili Peppers | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 39 | Shuggie Otis | **1** | 1 | 0 | HEADY (`heady`): **1** (1 exact / 0 artist) |
| 40 | T. Rex | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 41 | Tears for Fears | **1** | 0 | 1 | Championshipvinyl (`championshipvinyl`): **1** (0 exact / 1 artist) |
| 42 | Temples | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 43 | The Band | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 44 | The Beach Boys | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 45 | The Blue Nile | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 46 | The Lazy Eyes | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 47 | The Replacements | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 48 | Thee Oh Sees | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 49 | This Will Destroy You | **1** | 0 | 1 | Championshipvinyl (`championshipvinyl`): **1** (0 exact / 1 artist) |
| 50 | Woods | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |

## Discovery

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | Depeche Mode | **28** | 0 | 28 | Synthradio (`synthradio`): **13** (0 exact / 13 artist)<br>Big R Radio - The Wave (`big-r-radio-the-wave`): **4** (0 exact / 4 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>PANORAMA80 (`panorama80`): **1** (0 exact / 1 artist)<br>Radio Armisa (`radio-armisa`): **1** (0 exact / 1 artist)<br>Radio FM (`radio-fm`): **1** (0 exact / 1 artist)<br>Radio Mela (`radio-mela`): **1** (0 exact / 1 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 2 | Altın Gün | **12** | 3 | 9 | Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **4** (1 exact / 3 artist)<br>Radio Paradise World/Etc Mix 320k AAC (`radio-paradise-world-etc-mix-320k-aac`): **4** (1 exact / 3 artist)<br>Radio Paradise World/ETC Mix 192k MP3 (`radio-paradise-world-etc-mix-192k-mp3`): **3** (1 exact / 2 artist)<br>C Lab (`c-lab`): **1** (0 exact / 1 artist) |
| 3 | Dengue Fever | **9** | 0 | 9 | Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **3** (0 exact / 3 artist)<br>Radio Paradise World/ETC Mix 192k MP3 (`radio-paradise-world-etc-mix-192k-mp3`): **3** (0 exact / 3 artist)<br>Radio Paradise World/Etc Mix 320k AAC (`radio-paradise-world-etc-mix-320k-aac`): **3** (0 exact / 3 artist) |
| 4 | Talking Heads | **9** | 0 | 9 | Big R Radio - The Wave (`big-r-radio-the-wave`): **3** (0 exact / 3 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>Radio FM (`radio-fm`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 5 | The Cure | **7** | 0 | 7 | Big R Radio - The Wave (`big-r-radio-the-wave`): **3** (0 exact / 3 artist)<br>DKFM Classic (`dkfm-classic`): **2** (0 exact / 2 artist)<br>6forty Radio (`6forty-radio`): **1** (0 exact / 1 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist) |
| 6 | Gong | **6** | 0 | 6 | Avant-Prog/Rock in Opposition/Canterbury Scene/Zeuhl - Radio Caprice (`avant-prog-rock-in-opposition-canterbury-scene-zeuhl-radio-caprice`): **6** (0 exact / 6 artist) |
| 7 | Nirvana | **6** | 0 | 6 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (0 exact / 3 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **3** (0 exact / 3 artist) |
| 8 | Pink Floyd | **6** | 0 | 6 | Nostalgie New York (`nostalgie-new-york`): **3** (0 exact / 3 artist)<br>Heavy Music Atmospheric Radio (`heavy-music-atmospheric-radio`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 9 | Duran Duran | **5** | 0 | 5 | Big R Radio - The Wave (`big-r-radio-the-wave`): **4** (0 exact / 4 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (0 exact / 1 artist) |
| 10 | Queen | **5** | 0 | 5 | Synthradio (`synthradio`): **2** (0 exact / 2 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist) |
| 11 | Bronski Beat | **4** | 0 | 4 | Big R Radio - The Wave (`big-r-radio-the-wave`): **3** (0 exact / 3 artist)<br>Radio Mela (`radio-mela`): **1** (0 exact / 1 artist) |
| 12 | Billy Idol | **3** | 0 | 3 | Nostalgie New York (`nostalgie-new-york`): **2** (0 exact / 2 artist)<br>KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist) |
| 13 | Björk | **3** | 0 | 3 | RMC Nights Story (`rmc-nights-story`): **2** (0 exact / 2 artist)<br>Experimental/Avant-garde music - Radio Caprice (`experimental-avant-garde-music-radio-caprice`): **1** (0 exact / 1 artist) |
| 14 | Chaka Khan | **3** | 0 | 3 | RMC Nights Story (`rmc-nights-story`): **2** (0 exact / 2 artist)<br>C Lab (`c-lab`): **1** (0 exact / 1 artist) |
| 15 | David Bowie | **3** | 0 | 3 | RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>Synthradio (`synthradio`): **1** (0 exact / 1 artist) |
| 16 | Fela Kuti | **3** | 0 | 3 | Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **1** (0 exact / 1 artist)<br>Radio Paradise World/ETC Mix 192k MP3 (`radio-paradise-world-etc-mix-192k-mp3`): **1** (0 exact / 1 artist)<br>Radio Paradise World/Etc Mix 320k AAC (`radio-paradise-world-etc-mix-320k-aac`): **1** (0 exact / 1 artist) |
| 17 | Fleetwood Mac | **3** | 0 | 3 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist) |
| 18 | Khruangbin | **3** | 0 | 3 | WBEZ-HD2 "Vocalo Stream" Chicago, IL (`wbez-hd2-vocalo-stream-chicago-il`): **2** (0 exact / 2 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 19 | LADY GAGA | **3** | 0 | 3 | ..87,5!. Nantes (`87-5-nantes`): **1** (0 exact / 1 artist)<br>i love radio - greatest hits (`i-love-radio-greatest-hits`): **1** (0 exact / 1 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (0 exact / 1 artist) |
| 20 | Lady Gaga | **3** | 0 | 3 | i love radio - greatest hits (`i-love-radio-greatest-hits`): **2** (0 exact / 2 artist)<br>..87,5!. Nantes (`87-5-nantes`): **1** (0 exact / 1 artist) |
| 21 | Marvin Gaye | **3** | 0 | 3 | Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 22 | Mulatu Astatke | **3** | 0 | 3 | Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **1** (0 exact / 1 artist)<br>Radio Paradise World/ETC Mix 192k MP3 (`radio-paradise-world-etc-mix-192k-mp3`): **1** (0 exact / 1 artist)<br>Radio Paradise World/Etc Mix 320k AAC (`radio-paradise-world-etc-mix-320k-aac`): **1** (0 exact / 1 artist) |
| 23 | Neil Young | **3** | 0 | 3 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 24 | Prince | **3** | 0 | 3 | FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist)<br>RMC Nights Story (`rmc-nights-story`): **1** (0 exact / 1 artist)<br>RMC Voyage Voyage (`rmc-voyage-voyage`): **1** (0 exact / 1 artist) |
| 25 | ROSALÍA | **3** | 0 | 3 | Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **1** (0 exact / 1 artist)<br>Radio Paradise World/ETC Mix 192k MP3 (`radio-paradise-world-etc-mix-192k-mp3`): **1** (0 exact / 1 artist)<br>Radio Paradise World/Etc Mix 320k AAC (`radio-paradise-world-etc-mix-320k-aac`): **1** (0 exact / 1 artist) |
| 26 | Sigur Rós | **3** | 0 | 3 | Heavy Music Atmospheric Radio (`heavy-music-atmospheric-radio`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 27 | Steely Dan | **3** | 3 | 0 | Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (1 exact / 0 artist) |
| 28 | Tears For Fears | **3** | 0 | 3 | Big R Radio - The Wave (`big-r-radio-the-wave`): **2** (0 exact / 2 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 29 | THE ALAN PARSONS PROJECT | **3** | 0 | 3 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 30 | The Beach Boys | **3** | 0 | 3 | Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 31 | The Beatles | **3** | 0 | 3 | Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist) |
| 32 | The Smiths | **3** | 0 | 3 | Big R Radio - The Wave (`big-r-radio-the-wave`): **2** (0 exact / 2 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 33 | Billy Joel | **2** | 0 | 2 | Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist) |
| 34 | Cars | **2** | 0 | 2 | Big R Radio - The Wave (`big-r-radio-the-wave`): **2** (0 exact / 2 artist) |
| 35 | Chelsea Wolfe | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 36 | Chinese American Bear | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 37 | Clark | **2** | 0 | 2 | Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **2** (0 exact / 2 artist) |
| 38 | Counting Crows | **2** | 0 | 2 | RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>WUMB (`wumb`): **1** (0 exact / 1 artist) |
| 39 | Creedence Clearwater Revival | **2** | 0 | 2 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist) |
| 40 | Dave Matthews Band | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 41 | Die Spitz | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 42 | Ecce Shnak | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 43 | Eurythmics | **2** | 0 | 2 | Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (0 exact / 1 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist) |
| 44 | Grateful Dead | **2** | 0 | 2 | East Tennessee's Own WDVX 89.9 FM (`east-tennessee-s-own-wdvx-89-9-fm`): **1** (0 exact / 1 artist)<br>WPKN 89.5 FM (`wpkn`): **1** (0 exact / 1 artist) |
| 45 | Jodeci | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 46 | KING CRIMSON | **2** | 0 | 2 | Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 47 | MAXWELL | **2** | 0 | 2 | Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 48 | Maxwell | **2** | 0 | 2 | RMC Nights Story (`rmc-nights-story`): **1** (0 exact / 1 artist)<br>SWISS GROOVE (`swiss-groove`): **1** (0 exact / 1 artist) |
| 49 | Missing Persons | **2** | 0 | 2 | Big R Radio - The Wave (`big-r-radio-the-wave`): **2** (0 exact / 2 artist) |
| 50 | MJ Lenderman | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 51 | Peter Gabriel | **2** | 0 | 2 | RMC Nights Story (`rmc-nights-story`): **1** (0 exact / 1 artist)<br>RMC Voyage Voyage (`rmc-voyage-voyage`): **1** (0 exact / 1 artist) |
| 52 | Phil Collins | **2** | 0 | 2 | Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>Radio Mela (`radio-mela`): **1** (0 exact / 1 artist) |
| 53 | Poliça | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 54 | Pye Corner Audio | **2** | 0 | 2 | Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **2** (0 exact / 2 artist) |
| 55 | Rothko | **2** | 0 | 2 | Radio Caprice - Post-rock (`radio-caprice-post-rock`): **2** (0 exact / 2 artist) |
| 56 | Tangerine Dream | **2** | 0 | 2 | Radio Caprice - Krautrock (`radio-caprice-krautrock`): **2** (0 exact / 2 artist) |
| 57 | Tears for Fears | **2** | 0 | 2 | Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (0 exact / 1 artist)<br>Radio FM (`radio-fm`): **1** (0 exact / 1 artist) |
| 58 | Teddy Swims | **2** | 1 | 1 | i love radio - greatest hits (`i-love-radio-greatest-hits`): **1** (1 exact / 0 artist)<br>MFM STATION (`mfm-station`): **1** (0 exact / 1 artist) |
| 59 | The Brian Jonestown Massacre | **2** | 0 | 2 | DKFM Classic (`dkfm-classic`): **2** (0 exact / 2 artist) |
| 60 | This Will Destroy You | **2** | 0 | 2 | 6forty Radio (`6forty-radio`): **1** (0 exact / 1 artist)<br>Radio Caprice - Post-rock (`radio-caprice-post-rock`): **1** (0 exact / 1 artist) |
| 61 | Turnstile | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 62 | Alain Goraguer | **1** | 0 | 1 | shirley & spinoza (`shirley-spinoza`): **1** (0 exact / 1 artist) |
| 63 | Bauhaus | **1** | 0 | 1 | Sfliny Alternative 80's (`sfliny-alternative-80-s`): **1** (0 exact / 1 artist) |
| 64 | Bone Thugs‐n‐Harmony | **1** | 0 | 1 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist) |
| 65 | Brian Jonestown Massacre | **1** | 0 | 1 | DKFM Classic (`dkfm-classic`): **1** (0 exact / 1 artist) |
| 66 | Empire of the Sun | **1** | 0 | 1 | Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist) |
| 67 | Floating Points | **1** | 0 | 1 | dinamo.fm smog (`dinamo-fm-smog`): **1** (0 exact / 1 artist) |
| 68 | Galaxie 500 | **1** | 0 | 1 | DKFM Classic (`dkfm-classic`): **1** (0 exact / 1 artist) |
| 69 | Gorillaz | **1** | 0 | 1 | i love radio - greatest hits (`i-love-radio-greatest-hits`): **1** (0 exact / 1 artist) |
| 70 | Heathered Pearls | **1** | 0 | 1 | dinamo.fm smog (`dinamo-fm-smog`): **1** (0 exact / 1 artist) |
| 71 | Holy Fawn | **1** | 0 | 1 | 6forty Radio (`6forty-radio`): **1** (0 exact / 1 artist) |
| 72 | John Maus | **1** | 0 | 1 | PANORAMA80 (`panorama80`): **1** (0 exact / 1 artist) |
| 73 | Kangding Ray | **1** | 0 | 1 | Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **1** (0 exact / 1 artist) |
| 74 | King Gizzard & the Lizard Wizard | **1** | 0 | 1 | Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist) |
| 75 | Kodomo | **1** | 0 | 1 | SomaFM Black Rock FM (128k AAC Non-SSL) (`somafm-black-rock-fm-128k-aac-non-ssl`): **1** (0 exact / 1 artist) |
| 76 | KOKOROKO | **1** | 1 | 0 | Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **1** (1 exact / 0 artist) |
| 77 | Kraftwerk | **1** | 0 | 1 | PANORAMA80 (`panorama80`): **1** (0 exact / 1 artist) |
| 78 | Low | **1** | 0 | 1 | 6forty Radio (`6forty-radio`): **1** (0 exact / 1 artist) |
| 79 | Manuel Göttsching | **1** | 0 | 1 | Radio Caprice - Krautrock (`radio-caprice-krautrock`): **1** (0 exact / 1 artist) |
| 80 | MGMT | **1** | 0 | 1 | i love radio - greatest hits (`i-love-radio-greatest-hits`): **1** (0 exact / 1 artist) |
| 81 | Momma | **1** | 0 | 1 | WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 82 | Mr.Kitty | **1** | 0 | 1 | Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **1** (0 exact / 1 artist) |
| 83 | Nathan Fake | **1** | 0 | 1 | Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **1** (0 exact / 1 artist) |
| 84 | Nine Inch Nails | **1** | 0 | 1 | Synthradio (`synthradio`): **1** (0 exact / 1 artist) |
| 85 | Oneohtrix Point Never | **1** | 0 | 1 | Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **1** (0 exact / 1 artist) |
| 86 | Ozzy Osbourne | **1** | 0 | 1 | Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist) |
| 87 | Paul McCartney | **1** | 0 | 1 | Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist) |
| 88 | R.E.M. | **1** | 0 | 1 | Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist) |
| 89 | Roy Orbison | **1** | 0 | 1 | Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist) |
| 90 | Russian Circles | **1** | 0 | 1 | Radio Caprice - Post-rock (`radio-caprice-post-rock`): **1** (0 exact / 1 artist) |
| 91 | Son Lux | **1** | 0 | 1 | Experimental/Avant-garde music - Radio Caprice (`experimental-avant-garde-music-radio-caprice`): **1** (0 exact / 1 artist) |
| 92 | T. Rex | **1** | 0 | 1 | Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (0 exact / 1 artist) |
| 93 | The Eagles | **1** | 0 | 1 | WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 94 | The Replacements | **1** | 0 | 1 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist) |
| 95 | Thievery Corporation | **1** | 0 | 1 | SWISS GROOVE (`swiss-groove`): **1** (0 exact / 1 artist) |
| 96 | Tiffany | **1** | 0 | 1 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist) |
| 97 | TOKiMONSTA | **1** | 0 | 1 | ..87,5!. Nantes (`87-5-nantes`): **1** (0 exact / 1 artist) |
| 98 | Tokimonsta | **1** | 0 | 1 | Experimental/Avant-garde music - Radio Caprice (`experimental-avant-garde-music-radio-caprice`): **1** (0 exact / 1 artist) |
| 99 | Tommy Guerrero | **1** | 0 | 1 | C Lab (`c-lab`): **1** (0 exact / 1 artist) |
| 100 | Trentemøller | **1** | 0 | 1 | dinamo.fm smog (`dinamo-fm-smog`): **1** (0 exact / 1 artist) |
| 101 | Viagra Boys | **1** | 1 | 0 | WPKN 89.5 FM (`wpkn`): **1** (1 exact / 0 artist) |
| 102 | Wucan | **1** | 0 | 1 | Radio Caprice - Krautrock (`radio-caprice-krautrock`): **1** (0 exact / 1 artist) |

# 7 days

## Ambient

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | Phil Collins | **22** | 0 | 22 | Candelight (`candelight`): **12** (0 exact / 12 artist)<br>- 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **8** (0 exact / 8 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **2** (0 exact / 2 artist) |
| 2 | Queen | **15** | 0 | 15 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **12** (0 exact / 12 artist)<br>- 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **2** (0 exact / 2 artist)<br>Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 3 | The Beatles | **11** | 0 | 11 | Candelight (`candelight`): **5** (0 exact / 5 artist)<br>- 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **3** (0 exact / 3 artist)<br>Laut.FM Shoegaze (`laut-fm-shoegaze`): **2** (0 exact / 2 artist)<br>NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 4 | Genesis | **10** | 0 | 10 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **4** (0 exact / 4 artist)<br>- 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **3** (0 exact / 3 artist)<br>Candelight (`candelight`): **3** (0 exact / 3 artist) |
| 5 | Fleetwood Mac | **9** | 0 | 9 | Candelight (`candelight`): **9** (0 exact / 9 artist) |
| 6 | R.E.M. | **8** | 0 | 8 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **5** (0 exact / 5 artist)<br>Candelight (`candelight`): **2** (0 exact / 2 artist)<br>NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 7 | Jon Hopkins | **7** | 0 | 7 | SomaFM SF 10-33 (128k MP3) (`somafm-sf-10-33-128k-mp3`): **3** (0 exact / 3 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist)<br>NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist)<br>Radio Caprice: Ambient (`radio-caprice-ambient`): **1** (0 exact / 1 artist)<br>SomaFM DEF CON Radio (128k AAC) (`somafm-def-con-radio-128k-aac`): **1** (0 exact / 1 artist) |
| 8 | Tangerine Dream | **7** | 0 | 7 | Echoes of Bluemars (`echoes-of-bluemars`): **3** (0 exact / 3 artist)<br>Radio Caprice: Ambient (`radio-caprice-ambient`): **2** (0 exact / 2 artist)<br>Cryosleep (`cryosleep`): **1** (0 exact / 1 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist) |
| 9 | Oneohtrix Point Never | **6** | 0 | 6 | ISEKOI Radio \| Non-Stop Ambient (`isekoi-radio-non-stop-ambient`): **5** (0 exact / 5 artist)<br>NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 10 | Tears For Fears | **6** | 1 | 5 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **3** (1 exact / 2 artist)<br>Candelight (`candelight`): **2** (0 exact / 2 artist)<br>- 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist) |
| 11 | Tim Hecker | **6** | 0 | 6 | ISEKOI Radio \| Non-Stop Ambient (`isekoi-radio-non-stop-ambient`): **4** (0 exact / 4 artist)<br>Culture Failure (`culture-failure`): **1** (0 exact / 1 artist)<br>SomaFM Mission Control (128k MP3) (`somafm-mission-control-128k-mp3`): **1** (0 exact / 1 artist) |
| 12 | Billy Joel | **5** | 0 | 5 | Candelight (`candelight`): **4** (0 exact / 4 artist)<br>- 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist) |
| 13 | Prince | **5** | 0 | 5 | 100% ACID JAZZ (`100-acid-jazz`): **2** (0 exact / 2 artist)<br>Candelight (`candelight`): **2** (0 exact / 2 artist)<br>- 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist) |
| 14 | Heathered Pearls | **4** | 0 | 4 | SomaFM SF 10-33 (128k MP3) (`somafm-sf-10-33-128k-mp3`): **2** (0 exact / 2 artist)<br>Planet Ambi HD (`planet-ambi-hd`): **1** (0 exact / 1 artist)<br>SomaFM Mission Control (128k MP3) (`somafm-mission-control-128k-mp3`): **1** (0 exact / 1 artist) |
| 15 | Beach House | **3** | 0 | 3 | 181.FM - Chilled Out (USA) 128k mp3 (`181-fm-chilled-out-usa-128k-mp3`): **2** (0 exact / 2 artist)<br>Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 16 | Duran Duran | **3** | 0 | 3 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist)<br>Candelight (`candelight`): **1** (0 exact / 1 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist) |
| 17 | Jim Croce | **3** | 0 | 3 | Candelight (`candelight`): **3** (0 exact / 3 artist) |
| 18 | Marvin Gaye | **3** | 0 | 3 | Candelight (`candelight`): **3** (0 exact / 3 artist) |
| 19 | Surprise Chef | **3** | 2 | 1 | NEU RADIO (`neu-radio`): **3** (2 exact / 1 artist) |
| 20 | The Beach Boys | **3** | 0 | 3 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist)<br>Candelight (`candelight`): **1** (0 exact / 1 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist) |
| 21 | The Cure | **3** | 0 | 3 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist)<br>Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist)<br>NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 22 | Underworld | **3** | 0 | 3 | SomaFM DEF CON Radio (128k AAC) (`somafm-def-con-radio-128k-aac`): **2** (0 exact / 2 artist)<br>Culture Failure (`culture-failure`): **1** (0 exact / 1 artist) |
| 23 | Alan Parsons Project | **2** | 0 | 2 | Candelight (`candelight`): **2** (0 exact / 2 artist) |
| 24 | Billy Idol | **2** | 0 | 2 | Candelight (`candelight`): **1** (0 exact / 1 artist)<br>Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 25 | Britney Spears | **2** | 0 | 2 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **2** (0 exact / 2 artist) |
| 26 | David Bowie | **2** | 0 | 2 | Candelight (`candelight`): **2** (0 exact / 2 artist) |
| 27 | Depeche Mode | **2** | 0 | 2 | 181.FM - Chilled Out (USA) 128k mp3 (`181-fm-chilled-out-usa-128k-mp3`): **1** (0 exact / 1 artist)<br>NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 28 | Empire of the Sun | **2** | 0 | 2 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist)<br>SomaFM DEF CON Radio (128k AAC) (`somafm-def-con-radio-128k-aac`): **1** (0 exact / 1 artist) |
| 29 | Eurythmics | **2** | 0 | 2 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **2** (0 exact / 2 artist) |
| 30 | Jimi Hendrix | **2** | 0 | 2 | Candelight (`candelight`): **2** (0 exact / 2 artist) |
| 31 | Journey | **2** | 1 | 1 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (1 exact / 0 artist) |
| 32 | Kate Bush | **2** | 0 | 2 | Candelight (`candelight`): **2** (0 exact / 2 artist) |
| 33 | Khruangbin | **2** | 0 | 2 | NEU RADIO (`neu-radio`): **2** (0 exact / 2 artist) |
| 34 | LADY GAGA | **2** | 0 | 2 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist)<br>Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 35 | Murcof | **2** | 0 | 2 | SomaFM Mission Control (128k MP3) (`somafm-mission-control-128k-mp3`): **1** (0 exact / 1 artist)<br>SomaFM SF 10-33 (128k MP3) (`somafm-sf-10-33-128k-mp3`): **1** (0 exact / 1 artist) |
| 36 | Nathan Fake | **2** | 0 | 2 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist)<br>SomaFM DEF CON Radio (128k AAC) (`somafm-def-con-radio-128k-aac`): **1** (0 exact / 1 artist) |
| 37 | Neil Young | **2** | 0 | 2 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist)<br>Fluid Radio (`fluid-radio`): **1** (0 exact / 1 artist) |
| 38 | Peter Gabriel | **2** | 0 | 2 | Candelight (`candelight`): **1** (0 exact / 1 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist) |
| 39 | Teebs | **2** | 0 | 2 | SomaFM DEF CON Radio (128k AAC) (`somafm-def-con-radio-128k-aac`): **2** (0 exact / 2 artist) |
| 40 | The Cars | **2** | 0 | 2 | Candelight (`candelight`): **1** (0 exact / 1 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist) |
| 41 | Thievery Corporation | **2** | 0 | 2 | 181.FM - Chilled Out (USA) 128k mp3 (`181-fm-chilled-out-usa-128k-mp3`): **1** (0 exact / 1 artist)<br>Groove Wave Lounge (`groove-wave-lounge`): **1** (0 exact / 1 artist) |
| 42 | At the Drive‐In | **1** | 0 | 1 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 43 | Beach Boys | **1** | 0 | 1 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 44 | Beatles | **1** | 0 | 1 | Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 45 | beatles | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 46 | Björk | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 47 | Blood Orange | **1** | 1 | 0 | 181.FM - Chilled Out (USA) 128k mp3 (`181-fm-chilled-out-usa-128k-mp3`): **1** (1 exact / 0 artist) |
| 48 | Bob Marley & The Wailers | **1** | 0 | 1 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 49 | Bronski Beat | **1** | 0 | 1 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 50 | Chaka Khan | **1** | 0 | 1 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist) |
| 51 | Clark | **1** | 0 | 1 | SomaFM SF 10-33 (128k MP3) (`somafm-sf-10-33-128k-mp3`): **1** (0 exact / 1 artist) |
| 52 | Creedence Clearwater Revival | **1** | 0 | 1 | Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 53 | Deathprod | **1** | 1 | 0 | RADCAP: INDUSTRIAL / DARK / RITUAL AMBIENT (`radcap-industrial-dark-ritual-ambient`): **1** (1 exact / 0 artist) |
| 54 | Deerhoof | **1** | 1 | 0 | NEU RADIO (`neu-radio`): **1** (1 exact / 0 artist) |
| 55 | Dolly Parton | **1** | 1 | 0 | Candelight (`candelight`): **1** (1 exact / 0 artist) |
| 56 | Don Henley | **1** | 0 | 1 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist) |
| 57 | Fiction Factory | **1** | 1 | 0 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (1 exact / 0 artist) |
| 58 | Floating Points | **1** | 0 | 1 | SomaFM SF 10-33 (128k MP3) (`somafm-sf-10-33-128k-mp3`): **1** (0 exact / 1 artist) |
| 59 | Forest Swords | **1** | 0 | 1 | SomaFM DEF CON Radio (128k AAC) (`somafm-def-con-radio-128k-aac`): **1** (0 exact / 1 artist) |
| 60 | Félicia Atkinson | **1** | 1 | 0 | Fluid Radio (`fluid-radio`): **1** (1 exact / 0 artist) |
| 61 | Goldfrapp | **1** | 1 | 0 | NEU RADIO (`neu-radio`): **1** (1 exact / 0 artist) |
| 62 | Gorillaz | **1** | 0 | 1 | 181.FM - Chilled Out (USA) 128k mp3 (`181-fm-chilled-out-usa-128k-mp3`): **1** (0 exact / 1 artist) |
| 63 | Hans Zimmer | **1** | 0 | 1 | Fluid Radio (`fluid-radio`): **1** (0 exact / 1 artist) |
| 64 | Kraftwerk | **1** | 0 | 1 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist) |
| 65 | Lady Gaga | **1** | 0 | 1 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist) |
| 66 | Lee Paradise | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 67 | Max Cooper | **1** | 0 | 1 | SomaFM DEF CON Radio (128k AAC) (`somafm-def-con-radio-128k-aac`): **1** (0 exact / 1 artist) |
| 68 | Mazzy Star | **1** | 1 | 0 | 181.FM - Chilled Out (USA) 128k mp3 (`181-fm-chilled-out-usa-128k-mp3`): **1** (1 exact / 0 artist) |
| 69 | MGMT | **1** | 0 | 1 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist) |
| 70 | Modest Mouse | **1** | 0 | 1 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 71 | ODESZA | **1** | 0 | 1 | SomaFM DEF CON Radio (128k AAC) (`somafm-def-con-radio-128k-aac`): **1** (0 exact / 1 artist) |
| 72 | Paul McCartney | **1** | 0 | 1 | Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 73 | Peter Schilling | **1** | 1 | 0 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (1 exact / 0 artist) |
| 74 | Pink Floyd | **1** | 0 | 1 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist) |
| 75 | Poliça | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 76 | Ready for the World | **1** | 1 | 0 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (1 exact / 0 artist) |
| 77 | Red Hot Chili Peppers | **1** | 0 | 1 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist) |
| 78 | Righteous Brothers | **1** | 0 | 1 | Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 79 | Robbie Robertson | **1** | 1 | 0 | Candelight (`candelight`): **1** (1 exact / 0 artist) |
| 80 | Rothko | **1** | 0 | 1 | Culture Failure (`culture-failure`): **1** (0 exact / 1 artist) |
| 81 | Sofie Birch | **1** | 0 | 1 | ISEKOI Radio \| Non-Stop Ambient (`isekoi-radio-non-stop-ambient`): **1** (0 exact / 1 artist) |
| 82 | Taleen Kali | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 83 | THE ALAN PARSONS PROJECT | **1** | 0 | 1 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist) |
| 84 | The Alan Parsons Project | **1** | 0 | 1 | Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 85 | The Clean | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 86 | The Righteous Brothers | **1** | 0 | 1 | Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 87 | The Smiths | **1** | 0 | 1 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 88 | Thomas Fehlmann | **1** | 0 | 1 | Ambient Modern (`ambient-modern`): **1** (0 exact / 1 artist) |
| 89 | Thundercat | **1** | 1 | 0 | 100% ACID JAZZ (`100-acid-jazz`): **1** (1 exact / 0 artist) |
| 90 | Tiffany | **1** | 0 | 1 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist) |
| 91 | Tom Petty | **1** | 1 | 0 | Candelight (`candelight`): **1** (1 exact / 0 artist) |
| 92 | TOMAGA | **1** | 0 | 1 | SomaFM Mission Control (128k MP3) (`somafm-mission-control-128k-mp3`): **1** (0 exact / 1 artist) |
| 93 | Tony Allen | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |

## Campus

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | Dolly Parton | **40** | 1 | 39 | KALX 90.7 FM (`kalx`): **10** (1 exact / 9 artist)<br>WMFO 91.5 FM (`wmfo`): **8** (0 exact / 8 artist)<br>WPRB 103.3 FM (`wprb`): **6** (0 exact / 6 artist)<br>KXLU 88.9 FM (`kxlu`): **5** (0 exact / 5 artist)<br>KDVS 90.3 FM (`kdvs`): **4** (0 exact / 4 artist)<br>WKCR 89.9 FM (`wkcr`): **3** (0 exact / 3 artist)<br>KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist)<br>WBRS 100.1 FM (`wbrs`): **1** (0 exact / 1 artist)<br>WHRB 95.3 FM (`whrb`): **1** (0 exact / 1 artist)<br>WXYC 89.3 FM (`wxyc`): **1** (0 exact / 1 artist) |
| 2 | The Beatles | **11** | 0 | 11 | WMFO 91.5 FM (`wmfo`): **11** (0 exact / 11 artist) |
| 3 | Gorillaz | **7** | 0 | 7 | WMFO 91.5 FM (`wmfo`): **6** (0 exact / 6 artist)<br>KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist) |
| 4 | Depeche Mode | **4** | 0 | 4 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **4** (0 exact / 4 artist) |
| 5 | Holy Wave | **4** | 0 | 4 | KALX 90.7 FM (`kalx`): **2** (0 exact / 2 artist)<br>KVSC 88.1 FM (`kvsc`): **2** (0 exact / 2 artist) |
| 6 | Kate Bush | **4** | 1 | 3 | WMFO 91.5 FM (`wmfo`): **4** (1 exact / 3 artist) |
| 7 | Marvin Gaye | **4** | 0 | 4 | WMFO 91.5 FM (`wmfo`): **2** (0 exact / 2 artist)<br>KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 8 | MGMT | **4** | 0 | 4 | WMFO 91.5 FM (`wmfo`): **3** (0 exact / 3 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 9 | Modest Mouse | **4** | 1 | 3 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **2** (0 exact / 2 artist)<br>KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist)<br>KVSC 88.1 FM (`kvsc`): **1** (1 exact / 0 artist) |
| 10 | Neil Young | **4** | 0 | 4 | WMFO 91.5 FM (`wmfo`): **2** (0 exact / 2 artist)<br>KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 11 | R.E.M. | **4** | 0 | 4 | WMFO 91.5 FM (`wmfo`): **2** (0 exact / 2 artist)<br>KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 12 | Talking Heads | **4** | 0 | 4 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **2** (0 exact / 2 artist)<br>KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist)<br>WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 13 | The Cranberries | **4** | 0 | 4 | WMFO 91.5 FM (`wmfo`): **3** (0 exact / 3 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 14 | Ween | **4** | 0 | 4 | WMFO 91.5 FM (`wmfo`): **2** (0 exact / 2 artist)<br>KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist)<br>WUOG 90.5 FM (`wuog`): **1** (0 exact / 1 artist) |
| 15 | Björk | **3** | 0 | 3 | KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist)<br>WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist)<br>WUOG 90.5 FM (`wuog`): **1** (0 exact / 1 artist) |
| 16 | Foo Fighters | **3** | 0 | 3 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **2** (0 exact / 2 artist)<br>WICB 91.7 FM (`wicb`): **1** (0 exact / 1 artist) |
| 17 | Future Islands | **3** | 0 | 3 | KVSC 88.1 FM (`kvsc`): **2** (0 exact / 2 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 18 | Morrissey | **3** | 0 | 3 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **2** (0 exact / 2 artist)<br>WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 19 | Chelsea Wolfe | **2** | 0 | 2 | CJSR 88.5 FM (`cjsr`): **2** (0 exact / 2 artist) |
| 20 | David Bowie | **2** | 0 | 2 | WMFO 91.5 FM (`wmfo`): **2** (0 exact / 2 artist) |
| 21 | Deerhoof | **2** | 0 | 2 | WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist)<br>WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 22 | Fela Kuti | **2** | 1 | 1 | WUOG 90.5 FM (`wuog`): **2** (1 exact / 1 artist) |
| 23 | Fleetwood Mac | **2** | 0 | 2 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist)<br>WXYC 89.3 FM (`wxyc`): **1** (0 exact / 1 artist) |
| 24 | Lady Gaga | **2** | 0 | 2 | WMFO 91.5 FM (`wmfo`): **2** (0 exact / 2 artist) |
| 25 | MJ Lenderman | **2** | 0 | 2 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist)<br>WUOG 90.5 FM (`wuog`): **1** (0 exact / 1 artist) |
| 26 | Momma | **2** | 0 | 2 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist)<br>WXYC 89.3 FM (`wxyc`): **1** (0 exact / 1 artist) |
| 27 | Nirvana | **2** | 0 | 2 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 28 | Red Hot Chili Peppers | **2** | 0 | 2 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist)<br>WICB 91.7 FM (`wicb`): **1** (0 exact / 1 artist) |
| 29 | Soul Coughing | **2** | 0 | 2 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 30 | The Beach Boys | **2** | 0 | 2 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 31 | The Cure | **2** | 0 | 2 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist)<br>WXYC 89.3 FM (`wxyc`): **1** (0 exact / 1 artist) |
| 32 | The Replacements | **2** | 1 | 1 | KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist)<br>WZBC 90.3 FM (`wzbc`): **1** (1 exact / 0 artist) |
| 33 | The Smashing Pumpkins | **2** | 0 | 2 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist)<br>WICB 91.7 FM (`wicb`): **1** (0 exact / 1 artist) |
| 34 | All Them Witches | **1** | 0 | 1 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist) |
| 35 | Astrid Sonne | **1** | 0 | 1 | KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist) |
| 36 | Bauhaus | **1** | 0 | 1 | KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist) |
| 37 | Black Sabbath | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 38 | Bloc Party | **1** | 1 | 0 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (1 exact / 0 artist) |
| 39 | Britney Spears | **1** | 0 | 1 | WBRS 100.1 FM (`wbrs`): **1** (0 exact / 1 artist) |
| 40 | Broadcast | **1** | 1 | 0 | KDVS 90.3 FM (`kdvs`): **1** (1 exact / 0 artist) |
| 41 | Cheekface | **1** | 1 | 0 | KVSC 88.1 FM (`kvsc`): **1** (1 exact / 0 artist) |
| 42 | Chinese American Bear | **1** | 0 | 1 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 43 | Clark | **1** | 0 | 1 | WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 44 | Crosby, Stills, Nash & Young | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 45 | Dave Matthews Band | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 46 | Dead Meadow | **1** | 0 | 1 | WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 47 | Deftones | **1** | 0 | 1 | WBRS 100.1 FM (`wbrs`): **1** (0 exact / 1 artist) |
| 48 | Die Spitz | **1** | 0 | 1 | WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 49 | Duran Duran | **1** | 0 | 1 | WXYC 89.3 FM (`wxyc`): **1** (0 exact / 1 artist) |
| 50 | Eagles | **1** | 0 | 1 | WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 51 | Ed O’Brien | **1** | 0 | 1 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist) |
| 52 | Elephant Stone | **1** | 0 | 1 | WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 53 | Empire of the Sun | **1** | 0 | 1 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist) |
| 54 | FuzZ | **1** | 0 | 1 | WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 55 | G. Love | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 56 | Gong | **1** | 0 | 1 | WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 57 | Hole | **1** | 0 | 1 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 58 | Hum | **1** | 0 | 1 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist) |
| 59 | ICEAGE | **1** | 0 | 1 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist) |
| 60 | Jim Croce | **1** | 0 | 1 | KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist) |
| 61 | John Maus | **1** | 0 | 1 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist) |
| 62 | Kaitlyn Aurelia Smith | **1** | 0 | 1 | KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist) |
| 63 | Khruangbin | **1** | 0 | 1 | WKCR 89.9 FM (`wkcr`): **1** (0 exact / 1 artist) |
| 64 | King Crimson | **1** | 0 | 1 | KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist) |
| 65 | Kraftwerk | **1** | 0 | 1 | WXYC 89.3 FM (`wxyc`): **1** (0 exact / 1 artist) |
| 66 | La Luz | **1** | 0 | 1 | KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist) |
| 67 | Loathe | **1** | 0 | 1 | WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 68 | Low | **1** | 0 | 1 | KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist) |
| 69 | Lusine | **1** | 1 | 0 | WXYC 89.3 FM (`wxyc`): **1** (1 exact / 0 artist) |
| 70 | Max Cooper | **1** | 0 | 1 | WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 71 | Mk.gee | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 72 | Mr.Kitty | **1** | 0 | 1 | WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 73 | Nilüfer Yanya | **1** | 0 | 1 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 74 | Oneohtrix Point Never | **1** | 0 | 1 | KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist) |
| 75 | Pete Townshend | **1** | 1 | 0 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (1 exact / 0 artist) |
| 76 | Pile | **1** | 0 | 1 | WHRB 95.3 FM (`whrb`): **1** (0 exact / 1 artist) |
| 77 | Pink Floyd | **1** | 1 | 0 | KDVS 90.3 FM (`kdvs`): **1** (1 exact / 0 artist) |
| 78 | Prince | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 79 | Protomartyr | **1** | 0 | 1 | WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 80 | Queen | **1** | 0 | 1 | WICB 91.7 FM (`wicb`): **1** (0 exact / 1 artist) |
| 81 | Russian Circles | **1** | 0 | 1 | WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 82 | SLIFT | **1** | 0 | 1 | CJSR 88.5 FM (`cjsr`): **1** (0 exact / 1 artist) |
| 83 | Smashing Pumpkins | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 84 | Sofie Birch | **1** | 0 | 1 | WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 85 | Squid | **1** | 0 | 1 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 86 | St. Paul & The Broken Bones | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 87 | Steely Dan | **1** | 0 | 1 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 88 | Tears For Fears | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 89 | The Brian Jonestown Massacre | **1** | 0 | 1 | WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 90 | The Donnas | **1** | 1 | 0 | WMFO 91.5 FM (`wmfo`): **1** (1 exact / 0 artist) |
| 91 | The Glove | **1** | 0 | 1 | KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist) |
| 92 | The Meters | **1** | 1 | 0 | KALX 90.7 FM (`kalx`): **1** (1 exact / 0 artist) |
| 93 | The Nude Party | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 94 | The Righteous Brothers | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 95 | The Smiths | **1** | 0 | 1 | WXYC 89.3 FM (`wxyc`): **1** (0 exact / 1 artist) |
| 96 | The Voidz | **1** | 1 | 0 | WLUW 88.7 FM (`wluw`): **1** (1 exact / 0 artist) |
| 97 | The Wallflowers | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 98 | Thee Oh Sees | **1** | 0 | 1 | WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 99 | They Are Gutting a Body of Water | **1** | 0 | 1 | KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist) |
| 100 | Tim Hecker | **1** | 0 | 1 | WXYC 89.3 FM (`wxyc`): **1** (0 exact / 1 artist) |
| 101 | Trans Am | **1** | 0 | 1 | WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 102 | Turnstile | **1** | 1 | 0 | WMFO 91.5 FM (`wmfo`): **1** (1 exact / 0 artist) |
| 103 | Viagra Boys | **1** | 1 | 0 | KVSC 88.1 FM (`kvsc`): **1** (1 exact / 0 artist) |
| 104 | Wine Lips | **1** | 0 | 1 | WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |

## Specialist

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | The Cure | **19** | 0 | 19 | KEXP 90.3 FM (`kexp`): **6** (0 exact / 6 artist)<br>New Wave Radio (`new-wave-radio`): **4** (0 exact / 4 artist)<br>FIP Rock (`fip-rock`): **2** (0 exact / 2 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **1** (0 exact / 1 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **1** (0 exact / 1 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **1** (0 exact / 1 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (0 exact / 1 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **1** (0 exact / 1 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **1** (0 exact / 1 artist) |
| 2 | Depeche Mode | **17** | 0 | 17 | KEXP 90.3 FM (`kexp`): **4** (0 exact / 4 artist)<br>New Wave Radio (`new-wave-radio`): **3** (0 exact / 3 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **3** (0 exact / 3 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **2** (0 exact / 2 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **2** (0 exact / 2 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **1** (0 exact / 1 artist)<br>FIP Electro (`fip-electro`): **1** (0 exact / 1 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **1** (0 exact / 1 artist) |
| 3 | David Bowie | **15** | 2 | 13 | KEXP 90.3 FM (`kexp`): **5** (2 exact / 3 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **2** (0 exact / 2 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **2** (0 exact / 2 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **1** (0 exact / 1 artist)<br>FIP Electro (`fip-electro`): **1** (0 exact / 1 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist)<br>Gen X Radio (`gen-x-radio`): **1** (0 exact / 1 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (0 exact / 1 artist)<br>New Wave Radio (`new-wave-radio`): **1** (0 exact / 1 artist) |
| 4 | Talking Heads | **13** | 0 | 13 | KEXP 90.3 FM (`kexp`): **3** (0 exact / 3 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **2** (0 exact / 2 artist)<br>FIP Rock (`fip-rock`): **2** (0 exact / 2 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **2** (0 exact / 2 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **2** (0 exact / 2 artist)<br>New Wave Radio (`new-wave-radio`): **1** (0 exact / 1 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **1** (0 exact / 1 artist) |
| 5 | Eurythmics | **12** | 0 | 12 | SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **4** (0 exact / 4 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **3** (0 exact / 3 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **1** (0 exact / 1 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist)<br>KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (0 exact / 1 artist)<br>New Wave Radio (`new-wave-radio`): **1** (0 exact / 1 artist) |
| 6 | Grateful Dead | **12** | 0 | 12 | Radio Caprice - Psychedelic Folk (`radio-caprice-psychedelic-folk`): **11** (0 exact / 11 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 7 | R.E.M. | **11** | 0 | 11 | Gem Radio New Wave (`gem-radio-new-wave`): **3** (0 exact / 3 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **2** (0 exact / 2 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **2** (0 exact / 2 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist)<br>Gen X Radio (`gen-x-radio`): **1** (0 exact / 1 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist)<br>KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 8 | The Beatles | **11** | 0 | 11 | 24-7 Psychedelic Rock (`24-7-psychedelic-rock`): **6** (0 exact / 6 artist)<br>KEXP 90.3 FM (`kexp`): **3** (0 exact / 3 artist)<br>FIP Rock (`fip-rock`): **2** (0 exact / 2 artist) |
| 9 | The Cars | **11** | 0 | 11 | GEM New Wave Radio (`gem-new-wave-radio`): **2** (0 exact / 2 artist)<br>New Wave Radio (`new-wave-radio`): **2** (0 exact / 2 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **2** (0 exact / 2 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **2** (0 exact / 2 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **1** (0 exact / 1 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **1** (0 exact / 1 artist) |
| 10 | Duran Duran | **9** | 0 | 9 | New Wave Radio (`new-wave-radio`): **3** (0 exact / 3 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **2** (0 exact / 2 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **2** (0 exact / 2 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **1** (0 exact / 1 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **1** (0 exact / 1 artist) |
| 11 | Nirvana | **9** | 0 | 9 | KEXP 90.3 FM (`kexp`): **8** (0 exact / 8 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 12 | Pink Floyd | **9** | 0 | 9 | 24-7 Psychedelic Rock (`24-7-psychedelic-rock`): **8** (0 exact / 8 artist)<br>KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 13 | Missing Persons | **8** | 3 | 5 | SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **3** (1 exact / 2 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **2** (1 exact / 1 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **1** (0 exact / 1 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (1 exact / 0 artist)<br>New Wave Radio (`new-wave-radio`): **1** (0 exact / 1 artist) |
| 14 | Prince | **8** | 0 | 8 | Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **3** (0 exact / 3 artist)<br>KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist)<br>All Oldies Channel (`all-oldies-channel`): **1** (0 exact / 1 artist)<br>FIP Groove (`fip-groove`): **1** (0 exact / 1 artist)<br>Worldwide FM (`worldwide-fm`): **1** (0 exact / 1 artist) |
| 15 | Bananarama | **6** | 1 | 5 | 80's New Wave Radio (`80-s-new-wave-radio`): **3** (1 exact / 2 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **1** (0 exact / 1 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **1** (0 exact / 1 artist)<br>New Wave Radio (`new-wave-radio`): **1** (0 exact / 1 artist) |
| 16 | Dolly Parton | **6** | 0 | 6 | KEXP 90.3 FM (`kexp`): **5** (0 exact / 5 artist)<br>Gen X Radio (`gen-x-radio`): **1** (0 exact / 1 artist) |
| 17 | Jimi Hendrix | **6** | 0 | 6 | 24-7 Psychedelic Rock (`24-7-psychedelic-rock`): **3** (0 exact / 3 artist)<br>FIP Rock (`fip-rock`): **2** (0 exact / 2 artist)<br>KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 18 | Kraftwerk | **6** | 0 | 6 | 80's New Wave Radio (`80-s-new-wave-radio`): **2** (0 exact / 2 artist)<br>KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist)<br>80s Forever - We Keep The 80s Alive (`80s-forever-we-keep-the-80s-alive`): **1** (0 exact / 1 artist)<br>FIP Electro (`fip-electro`): **1** (0 exact / 1 artist) |
| 19 | Marvin Gaye | **6** | 0 | 6 | KEXP 90.3 FM (`kexp`): **5** (0 exact / 5 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist) |
| 20 | The Smiths | **6** | 0 | 6 | GEM New Wave Radio (`gem-new-wave-radio`): **2** (0 exact / 2 artist)<br>80s Alive (`80s-alive`): **1** (0 exact / 1 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **1** (0 exact / 1 artist)<br>New Wave Radio (`new-wave-radio`): **1** (0 exact / 1 artist) |
| 21 | Billy Idol | **5** | 0 | 5 | 80's New Wave Radio (`80-s-new-wave-radio`): **1** (0 exact / 1 artist)<br>KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist)<br>New Wave Radio (`new-wave-radio`): **1** (0 exact / 1 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **1** (0 exact / 1 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **1** (0 exact / 1 artist) |
| 22 | Fleetwood Mac | **5** | 0 | 5 | Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **2** (0 exact / 2 artist)<br>All Oldies Channel (`all-oldies-channel`): **1** (0 exact / 1 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist)<br>KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 23 | Tears for Fears | **5** | 0 | 5 | 80's New Wave Radio (`80-s-new-wave-radio`): **2** (0 exact / 2 artist)<br>80s Alive (`80s-alive`): **1** (0 exact / 1 artist)<br>KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (0 exact / 1 artist) |
| 24 | Björk | **4** | 0 | 4 | KEXP 90.3 FM (`kexp`): **3** (0 exact / 3 artist)<br>FIP Electro (`fip-electro`): **1** (0 exact / 1 artist) |
| 25 | Cars | **4** | 0 | 4 | New Wave - BestNet Radio (`new-wave-bestnet-radio`): **3** (0 exact / 3 artist)<br>KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 26 | Castle Rat | **4** | 0 | 4 | SomaFM Metal Detector (128k AAC) (`somafm-metal-detector-128k-aac`): **2** (0 exact / 2 artist)<br>SomaFM Metal Detector (128k MP3) (`somafm-metal-detector-128k-mp3`): **2** (0 exact / 2 artist) |
| 27 | Neil Young | **4** | 0 | 4 | FIP Rock (`fip-rock`): **2** (0 exact / 2 artist)<br>KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 28 | Tears For Fears | **4** | 0 | 4 | New Wave - BestNet Radio (`new-wave-bestnet-radio`): **2** (0 exact / 2 artist)<br>New Wave Radio (`new-wave-radio`): **2** (0 exact / 2 artist) |
| 29 | The The | **4** | 0 | 4 | GEM New Wave Radio (`gem-new-wave-radio`): **2** (0 exact / 2 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **2** (0 exact / 2 artist) |
| 30 | Woods | **4** | 0 | 4 | Radio Caprice - Psychedelic Folk (`radio-caprice-psychedelic-folk`): **3** (0 exact / 3 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 31 | At the Drive‐In | **3** | 0 | 3 | KEXP 90.3 FM (`kexp`): **3** (0 exact / 3 artist) |
| 32 | Bauhaus | **3** | 0 | 3 | GEM New Wave Radio (`gem-new-wave-radio`): **1** (0 exact / 1 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **1** (0 exact / 1 artist)<br>KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 33 | Beatles | **3** | 0 | 3 | 24-7 Psychedelic Rock (`24-7-psychedelic-rock`): **3** (0 exact / 3 artist) |
| 34 | Die Spitz | **3** | 1 | 2 | KEXP 90.3 FM (`kexp`): **3** (1 exact / 2 artist) |
| 35 | Hurray for the Riff Raff | **3** | 1 | 2 | FIP Rock (`fip-rock`): **1** (1 exact / 0 artist)<br>SomaFM Folk Forward (128k AAC) (`somafm-folk-forward-128k-aac`): **1** (0 exact / 1 artist)<br>SomaFM Folk Forward (128k MP3) (`somafm-folk-forward-128k-mp3`): **1** (0 exact / 1 artist) |
| 36 | Juana Molina | **3** | 0 | 3 | FIP Electro (`fip-electro`): **1** (0 exact / 1 artist)<br>FIP World (`fip-world`): **1** (0 exact / 1 artist)<br>KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 37 | Modest Mouse | **3** | 0 | 3 | KEXP 90.3 FM (`kexp`): **3** (0 exact / 3 artist) |
| 38 | Thievery Corporation | **3** | 0 | 3 | FIP Reggae (`fip-reggae`): **1** (0 exact / 1 artist)<br>KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist)<br>SomaFM — Suburbs of Goa (`somafm-suburbsofgoa`): **1** (0 exact / 1 artist) |
| 39 | Thomas Fehlmann | **3** | 0 | 3 | SomaFM — CliqHop IDM (`somafm-cliqhop`): **2** (0 exact / 2 artist)<br>Radio Caprice - Experimental Techno [2] (`radio-caprice-experimental-techno-2`): **1** (0 exact / 1 artist) |
| 40 | Underworld | **3** | 0 | 3 | FIP Electro (`fip-electro`): **1** (0 exact / 1 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **1** (0 exact / 1 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **1** (0 exact / 1 artist) |
| 41 | Black Sabbath | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 42 | Bob Marley & The Wailers | **2** | 0 | 2 | FIP Reggae (`fip-reggae`): **2** (0 exact / 2 artist) |
| 43 | Bronski Beat | **2** | 0 | 2 | New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (0 exact / 1 artist)<br>New Wave Radio (`new-wave-radio`): **1** (0 exact / 1 artist) |
| 44 | Chelsea Wolfe | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 45 | Dungen | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 46 | Ghost | **2** | 0 | 2 | Radio Caprice - Psychedelic Folk (`radio-caprice-psychedelic-folk`): **2** (0 exact / 2 artist) |
| 47 | Gorillaz | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 48 | Kate Bush | **2** | 0 | 2 | Gem Radio New Wave (`gem-radio-new-wave`): **1** (0 exact / 1 artist)<br>SomaFM — Lush (`somafm-lush`): **1** (0 exact / 1 artist) |
| 49 | Kikagaku Moyo | **2** | 0 | 2 | FIP Rock (`fip-rock`): **1** (0 exact / 1 artist)<br>KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 50 | King Gizzard & the Lizard Wizard | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 51 | Max Cooper | **2** | 0 | 2 | Radio Caprice - Experimental Techno [2] (`radio-caprice-experimental-techno-2`): **1** (0 exact / 1 artist)<br>SomaFM — CliqHop IDM (`somafm-cliqhop`): **1** (0 exact / 1 artist) |
| 52 | MJ Lenderman | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 53 | Murcof | **2** | 0 | 2 | SomaFM — CliqHop IDM (`somafm-cliqhop`): **2** (0 exact / 2 artist) |
| 54 | Nancy Sinatra | **2** | 0 | 2 | FIP Jazz (`fip-jazz`): **1** (0 exact / 1 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 55 | Nina Simone | **2** | 0 | 2 | FIP Jazz (`fip-jazz`): **2** (0 exact / 2 artist) |
| 56 | Phil Collins | **2** | 0 | 2 | 80s Alive (`80s-alive`): **2** (0 exact / 2 artist) |
| 57 | Poliça | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist)<br>SomaFM — Lush (`somafm-lush`): **1** (0 exact / 1 artist) |
| 58 | Queen | **2** | 0 | 2 | All Oldies Channel (`all-oldies-channel`): **1** (0 exact / 1 artist)<br>KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 59 | Sigur Rós | **2** | 0 | 2 | FIP Rock (`fip-rock`): **1** (0 exact / 1 artist)<br>KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 60 | Smashing Pumpkins | **2** | 0 | 2 | FIP Rock (`fip-rock`): **1** (0 exact / 1 artist)<br>KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 61 | Steely Dan | **2** | 1 | 1 | Gen X Radio (`gen-x-radio`): **1** (0 exact / 1 artist)<br>KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 62 | The Black Dog | **2** | 0 | 2 | Radio Caprice - Experimental Techno [2] (`radio-caprice-experimental-techno-2`): **1** (0 exact / 1 artist)<br>SomaFM — CliqHop IDM (`somafm-cliqhop`): **1** (0 exact / 1 artist) |
| 63 | Tim Hecker | **2** | 0 | 2 | RADCAP: DRONE AMBIENT (`radcap-drone-ambient`): **2** (0 exact / 2 artist) |
| 64 | Trentemøller | **2** | 0 | 2 | FIP Electro (`fip-electro`): **1** (0 exact / 1 artist)<br>KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 65 | Turnstile | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 66 | Wine Lips | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 67 | Altın Gün | **1** | 0 | 1 | FIP World (`fip-world`): **1** (0 exact / 1 artist) |
| 68 | Amtrac | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 69 | Arc De Soleil | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 70 | Automatic | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 71 | Balmorhea | **1** | 0 | 1 | SomaFM Folk Forward (128k MP3) (`somafm-folk-forward-128k-mp3`): **1** (0 exact / 1 artist) |
| 72 | Bone Thugs‐n‐Harmony | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 73 | Brian Jonestown Massacre | **1** | 0 | 1 | FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 74 | Britney Spears | **1** | 0 | 1 | Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist) |
| 75 | Bruce Hornsby | **1** | 0 | 1 | Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist) |
| 76 | Chinese American Bear | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 77 | Clark | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 78 | Connan Mockasin | **1** | 1 | 0 | FIP Rock (`fip-rock`): **1** (1 exact / 0 artist) |
| 79 | Dave Matthews Band | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 80 | Dengue Fever | **1** | 0 | 1 | FIP World (`fip-world`): **1** (0 exact / 1 artist) |
| 81 | DOOM GONG | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 82 | Eagles | **1** | 1 | 0 | FIP Rock (`fip-rock`): **1** (1 exact / 0 artist) |
| 83 | Ecce Shnak | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 84 | Ed O'Brien | **1** | 0 | 1 | FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 85 | Emerson, Lake & Palmer | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 86 | Floating Points | **1** | 0 | 1 | FIP Electro (`fip-electro`): **1** (0 exact / 1 artist) |
| 87 | Foo Fighters | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 88 | Future Islands | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 89 | Glen Campbell | **1** | 1 | 0 | Gen X Radio (`gen-x-radio`): **1** (1 exact / 0 artist) |
| 90 | GoGo Penguin | **1** | 0 | 1 | FIP Jazz (`fip-jazz`): **1** (0 exact / 1 artist) |
| 91 | Gong | **1** | 0 | 1 | FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 92 | Greta Van Fleet | **1** | 0 | 1 | FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 93 | Guns N’ Roses | **1** | 0 | 1 | 80s Alive (`80s-alive`): **1** (0 exact / 1 artist) |
| 94 | Hans Zimmer | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 95 | Iceage | **1** | 0 | 1 | FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 96 | Jim Croce | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 97 | Jodeci | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 98 | John Maus | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 99 | Khruangbin | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 100 | King Gizzard & The Lizard Wizard | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 101 | Men I Trust | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 102 | MGMT | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 103 | Mk.gee | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 104 | Nick Gilder | **1** | 0 | 1 | FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 105 | Nine Inch Nails | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 106 | Oneohtrix Point Never | **1** | 0 | 1 | RADCAP: DRONE AMBIENT (`radcap-drone-ambient`): **1** (0 exact / 1 artist) |
| 107 | Pat Benatar | **1** | 0 | 1 | 80s Alive (`80s-alive`): **1** (0 exact / 1 artist) |
| 108 | Paul McCartney | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 109 | Peter Gabriel | **1** | 0 | 1 | 80's New Wave Radio (`80-s-new-wave-radio`): **1** (0 exact / 1 artist) |
| 110 | Peter Schilling | **1** | 1 | 0 | 80's New Wave Radio (`80-s-new-wave-radio`): **1** (1 exact / 0 artist) |
| 111 | Protomartyr | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 112 | Ratatat | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 113 | Red Hot Chili Peppers | **1** | 0 | 1 | FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 114 | Robert Palmer | **1** | 1 | 0 | FIP Electro (`fip-electro`): **1** (1 exact / 0 artist) |
| 115 | Rush | **1** | 0 | 1 | 80s Alive (`80s-alive`): **1** (0 exact / 1 artist) |
| 116 | Russian Circles | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 117 | Sleepy Sun | **1** | 0 | 1 | Radio Caprice - Psychedelic Folk (`radio-caprice-psychedelic-folk`): **1** (0 exact / 1 artist) |
| 118 | Surprise Chef | **1** | 0 | 1 | Worldwide FM (`worldwide-fm`): **1** (0 exact / 1 artist) |
| 119 | T. Rex | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 120 | The Band | **1** | 0 | 1 | Radio Caprice - Psychedelic Folk (`radio-caprice-psychedelic-folk`): **1** (0 exact / 1 artist) |
| 121 | The Brian Jonestown Massacre | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 122 | The Cranberries | **1** | 0 | 1 | FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 123 | The Observers | **1** | 0 | 1 | FIP Reggae (`fip-reggae`): **1** (0 exact / 1 artist) |
| 124 | The Psychedelic Furs | **1** | 1 | 0 | FIP Rock (`fip-rock`): **1** (1 exact / 0 artist) |
| 125 | The Replacements | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 126 | The Sisters of Mercy | **1** | 0 | 1 | New Wave Radio (`new-wave-radio`): **1** (0 exact / 1 artist) |
| 127 | The Temptations | **1** | 1 | 0 | FIP Groove (`fip-groove`): **1** (1 exact / 0 artist) |
| 128 | Thee Oh Sees | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 129 | TOKiMONSTA | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 130 | Tom Petty And The Heartbreakers | **1** | 1 | 0 | FIP Rock (`fip-rock`): **1** (1 exact / 0 artist) |
| 131 | Tony Allen | **1** | 0 | 1 | FIP World (`fip-world`): **1** (0 exact / 1 artist) |
| 132 | Ulver | **1** | 0 | 1 | RADCAP: DRONE AMBIENT (`radcap-drone-ambient`): **1** (0 exact / 1 artist) |
| 133 | Waveshaper | **1** | 0 | 1 | Nightride FM — Chillsynth (`nightride-chillsynth`): **1** (0 exact / 1 artist) |
| 134 | Yin Yin | **1** | 0 | 1 | FIP Groove (`fip-groove`): **1** (0 exact / 1 artist) |

## Core

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | Talking Heads | **4** | 0 | 4 | BBC 6 Music (`bbc-6music`): **2** (0 exact / 2 artist)<br>FIP (`fip-main`): **2** (0 exact / 2 artist) |
| 2 | David Bowie | **3** | 0 | 3 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist)<br>FIP (`fip-main`): **1** (0 exact / 1 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 3 | The Cure | **3** | 0 | 3 | BBC 6 Music (`bbc-6music`): **2** (0 exact / 2 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 4 | Chinese American Bear | **2** | 0 | 2 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 5 | Future Islands | **2** | 0 | 2 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **2** (0 exact / 2 artist) |
| 6 | Juana Molina | **2** | 0 | 2 | FIP (`fip-main`): **1** (0 exact / 1 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 7 | Kikagaku Moyo | **2** | 0 | 2 | FIP (`fip-main`): **1** (0 exact / 1 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 8 | Modest Mouse | **2** | 0 | 2 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist)<br>KUTX 98.9 FM (`kutx`): **1** (0 exact / 1 artist) |
| 9 | Prince | **2** | 0 | 2 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist)<br>FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 10 | The Beatles | **2** | 0 | 2 | FIP (`fip-main`): **1** (0 exact / 1 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 11 | Bombay Bicycle Club | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 12 | Broadcast | **1** | 1 | 0 | BBC 6 Music (`bbc-6music`): **1** (1 exact / 0 artist) |
| 13 | Chaka Khan | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 14 | Crosby, Stills, Nash & Young | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 15 | Depeche Mode | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 16 | Dolly Parton | **1** | 0 | 1 | FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 17 | Duran Duran | **1** | 0 | 1 | FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 18 | Holy Wave | **1** | 0 | 1 | KUTX 98.9 FM (`kutx`): **1** (0 exact / 1 artist) |
| 19 | Kate Bush | **1** | 1 | 0 | BBC 6 Music (`bbc-6music`): **1** (1 exact / 0 artist) |
| 20 | KOKOROKO | **1** | 0 | 1 | FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 21 | La Luz | **1** | 0 | 1 | FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 22 | Marvin Gaye | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 23 | Maxwell | **1** | 0 | 1 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 24 | MJ Lenderman | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 25 | Mulatu Astatke | **1** | 0 | 1 | FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 26 | Nancy Sinatra | **1** | 1 | 0 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (1 exact / 0 artist) |
| 27 | Neil Young | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 28 | Nina Simone | **1** | 0 | 1 | FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 29 | Nirvana | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 30 | Patsy Cline | **1** | 0 | 1 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 31 | Peter Gabriel | **1** | 0 | 1 | KUTX 98.9 FM (`kutx`): **1** (0 exact / 1 artist) |
| 32 | Sea Wolf | **1** | 1 | 0 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (1 exact / 0 artist) |
| 33 | The Alan Parsons Project | **1** | 0 | 1 | FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 34 | The Beach Boys | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 35 | The Divine Comedy | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 36 | The Smiths | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 37 | The The | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 38 | Thievery Corporation | **1** | 0 | 1 | KUTX 98.9 FM (`kutx`): **1** (0 exact / 1 artist) |
| 39 | Turnstile | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 40 | Underworld | **1** | 0 | 1 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 41 | Wine Lips | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |

## Public

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | Dolly Parton | **4** | 0 | 4 | CKUA Radio (`ckua`): **4** (0 exact / 4 artist) |
| 2 | Al Di Meola | **1** | 0 | 1 | CKUA Radio (`ckua`): **1** (0 exact / 1 artist) |
| 3 | Khruangbin | **1** | 0 | 1 | CKUA Radio (`ckua`): **1** (0 exact / 1 artist) |
| 4 | Marlon Williams | **1** | 1 | 0 | CKUA Radio (`ckua`): **1** (1 exact / 0 artist) |
| 5 | R.E.M. | **1** | 0 | 1 | CKUA Radio (`ckua`): **1** (0 exact / 1 artist) |
| 6 | The Band | **1** | 0 | 1 | WDIY 88.1 FM (`wdiy`): **1** (0 exact / 1 artist) |

## Independent DJ

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | The Smiths | **9** | 1 | 8 | Championshipvinyl (`championshipvinyl`): **3** (0 exact / 3 artist)<br>Super45.fm (`super45-fm`): **3** (0 exact / 3 artist)<br>HEADY (`heady`): **2** (1 exact / 1 artist)<br>Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 2 | David Bowie | **8** | 0 | 8 | Championshipvinyl (`championshipvinyl`): **6** (0 exact / 6 artist)<br>Super45.fm (`super45-fm`): **2** (0 exact / 2 artist) |
| 3 | Pink Floyd | **8** | 4 | 4 | Path through the Forest (`path-through-the-forest`): **6** (3 exact / 3 artist)<br>Championshipvinyl (`championshipvinyl`): **2** (1 exact / 1 artist) |
| 4 | Tears For Fears | **7** | 0 | 7 | Championshipvinyl (`championshipvinyl`): **5** (0 exact / 5 artist)<br>Yammat FM (`yammat-fm`): **2** (0 exact / 2 artist) |
| 5 | The Cure | **7** | 0 | 7 | HEADY (`heady`): **2** (0 exact / 2 artist)<br>Super45.fm (`super45-fm`): **2** (0 exact / 2 artist)<br>Yammat FM (`yammat-fm`): **2** (0 exact / 2 artist)<br>Path through the Forest (`path-through-the-forest`): **1** (0 exact / 1 artist) |
| 6 | Depeche Mode | **6** | 1 | 5 | Yammat FM (`yammat-fm`): **4** (1 exact / 3 artist)<br>Super45.fm (`super45-fm`): **2** (0 exact / 2 artist) |
| 7 | Future Islands | **6** | 0 | 6 | Championshipvinyl (`championshipvinyl`): **3** (0 exact / 3 artist)<br>Super45.fm (`super45-fm`): **3** (0 exact / 3 artist) |
| 8 | The Beatles | **6** | 0 | 6 | Championshipvinyl (`championshipvinyl`): **2** (0 exact / 2 artist)<br>Super45.fm (`super45-fm`): **2** (0 exact / 2 artist)<br>Yammat FM (`yammat-fm`): **2** (0 exact / 2 artist) |
| 9 | Squid | **5** | 0 | 5 | HEADY (`heady`): **4** (0 exact / 4 artist)<br>Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 10 | Foo Fighters | **4** | 0 | 4 | Championshipvinyl (`championshipvinyl`): **4** (0 exact / 4 artist) |
| 11 | Gorillaz | **4** | 0 | 4 | Yammat FM (`yammat-fm`): **3** (0 exact / 3 artist)<br>HEADY (`heady`): **1** (0 exact / 1 artist) |
| 12 | Modest Mouse | **4** | 0 | 4 | HEADY (`heady`): **4** (0 exact / 4 artist) |
| 13 | Sigur Rós | **4** | 0 | 4 | Championshipvinyl (`championshipvinyl`): **4** (0 exact / 4 artist) |
| 14 | Turnstile | **4** | 0 | 4 | HEADY (`heady`): **3** (0 exact / 3 artist)<br>Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 15 | Deftones | **3** | 1 | 2 | HEADY (`heady`): **3** (1 exact / 2 artist) |
| 16 | Khruangbin | **3** | 1 | 2 | Super45.fm (`super45-fm`): **2** (0 exact / 2 artist)<br>HEADY (`heady`): **1** (1 exact / 0 artist) |
| 17 | Kraftwerk | **3** | 0 | 3 | Path through the Forest (`path-through-the-forest`): **2** (0 exact / 2 artist)<br>Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 18 | Prince | **3** | 0 | 3 | Yammat FM (`yammat-fm`): **3** (0 exact / 3 artist) |
| 19 | Psychedelic Porn Crumpets | **3** | 0 | 3 | HEADY (`heady`): **3** (0 exact / 3 artist) |
| 20 | Red Hot Chili Peppers | **3** | 0 | 3 | HEADY (`heady`): **3** (0 exact / 3 artist) |
| 21 | Talking Heads | **3** | 0 | 3 | Super45.fm (`super45-fm`): **2** (0 exact / 2 artist)<br>Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 22 | Temples | **3** | 1 | 2 | HEADY (`heady`): **2** (1 exact / 1 artist)<br>Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 23 | Bauhaus | **2** | 0 | 2 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist)<br>Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 24 | Beach Fossils | **2** | 0 | 2 | HEADY (`heady`): **2** (0 exact / 2 artist) |
| 25 | Creedence Clearwater Revival | **2** | 1 | 1 | Path through the Forest (`path-through-the-forest`): **2** (1 exact / 1 artist) |
| 26 | Die Spitz | **2** | 1 | 1 | HEADY (`heady`): **2** (1 exact / 1 artist) |
| 27 | Jimi Hendrix | **2** | 0 | 2 | Path through the Forest (`path-through-the-forest`): **1** (0 exact / 1 artist)<br>Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 28 | Morrissey | **2** | 0 | 2 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist)<br>Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 29 | Nine Inch Nails | **2** | 0 | 2 | HEADY (`heady`): **2** (0 exact / 2 artist) |
| 30 | Nirvana | **2** | 0 | 2 | HEADY (`heady`): **2** (0 exact / 2 artist) |
| 31 | Paul McCartney | **2** | 0 | 2 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist)<br>Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 32 | R.E.M. | **2** | 0 | 2 | Super45.fm (`super45-fm`): **2** (0 exact / 2 artist) |
| 33 | Underworld | **2** | 0 | 2 | Yammat FM (`yammat-fm`): **2** (0 exact / 2 artist) |
| 34 | Viagra Boys | **2** | 1 | 1 | HEADY (`heady`): **2** (1 exact / 1 artist) |
| 35 | Acid King | **1** | 0 | 1 | Path through the Forest (`path-through-the-forest`): **1** (0 exact / 1 artist) |
| 36 | Arc De Soleil | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 37 | Ariel Pink | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 38 | Bananarama | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 39 | Björk | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 40 | Black Sabbath | **1** | 0 | 1 | Path through the Forest (`path-through-the-forest`): **1** (0 exact / 1 artist) |
| 41 | Bloc Party | **1** | 1 | 0 | HEADY (`heady`): **1** (1 exact / 0 artist) |
| 42 | Broadcast | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 43 | Catherine Wheel | **1** | 1 | 0 | Super45.fm (`super45-fm`): **1** (1 exact / 0 artist) |
| 44 | Chaka Khan | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 45 | Chat Pile | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 46 | Chromeo | **1** | 1 | 0 | Yammat FM (`yammat-fm`): **1** (1 exact / 0 artist) |
| 47 | David Byrne | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 48 | Dead Meadow | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 49 | Dehd | **1** | 1 | 0 | HEADY (`heady`): **1** (1 exact / 0 artist) |
| 50 | Eurythmics | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 51 | Everything Everything | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 52 | Fuzz | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 53 | Gong | **1** | 0 | 1 | Path through the Forest (`path-through-the-forest`): **1** (0 exact / 1 artist) |
| 54 | Hole | **1** | 0 | 1 | Path through the Forest (`path-through-the-forest`): **1** (0 exact / 1 artist) |
| 55 | Holy Wave | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 56 | John Maus | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 57 | Juana Molina | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 58 | Judas Priest | **1** | 0 | 1 | Path through the Forest (`path-through-the-forest`): **1** (0 exact / 1 artist) |
| 59 | Kate Bush | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 60 | Kikagaku Moyo | **1** | 1 | 0 | HEADY (`heady`): **1** (1 exact / 0 artist) |
| 61 | LCD Soundsystem | **1** | 1 | 0 | HEADY (`heady`): **1** (1 exact / 0 artist) |
| 62 | Maxwell | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 63 | Mazzy Star | **1** | 1 | 0 | HEADY (`heady`): **1** (1 exact / 0 artist) |
| 64 | Men I Trust | **1** | 1 | 0 | Yammat FM (`yammat-fm`): **1** (1 exact / 0 artist) |
| 65 | Mk.gee | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 66 | Monolord | **1** | 0 | 1 | Path through the Forest (`path-through-the-forest`): **1** (0 exact / 1 artist) |
| 67 | Nina Simone | **1** | 0 | 1 | Championshipvinyl (`championshipvinyl`): **1** (0 exact / 1 artist) |
| 68 | Orions Belte | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 69 | Peter Gabriel | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 70 | Protomartyr | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 71 | Roy Orbison | **1** | 0 | 1 | Path through the Forest (`path-through-the-forest`): **1** (0 exact / 1 artist) |
| 72 | Shuggie Otis | **1** | 1 | 0 | HEADY (`heady`): **1** (1 exact / 0 artist) |
| 73 | Sleep | **1** | 0 | 1 | Path through the Forest (`path-through-the-forest`): **1** (0 exact / 1 artist) |
| 74 | Sugar Candy Mountain | **1** | 1 | 0 | HEADY (`heady`): **1** (1 exact / 0 artist) |
| 75 | T. Rex | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 76 | Tears for Fears | **1** | 0 | 1 | Championshipvinyl (`championshipvinyl`): **1** (0 exact / 1 artist) |
| 77 | The Band | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 78 | The Beach Boys | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 79 | The Blue Nile | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 80 | The Lazy Eyes | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 81 | The Murlocs | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 82 | The Replacements | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 83 | Thee Oh Sees | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 84 | This Will Destroy You | **1** | 0 | 1 | Championshipvinyl (`championshipvinyl`): **1** (0 exact / 1 artist) |
| 85 | Tortoise | **1** | 1 | 0 | Super45.fm (`super45-fm`): **1** (1 exact / 0 artist) |
| 86 | Will Van Horn | **1** | 1 | 0 | HEADY (`heady`): **1** (1 exact / 0 artist) |
| 87 | Woods | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |

## Discovery

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | Depeche Mode | **66** | 3 | 63 | Synthradio (`synthradio`): **32** (1 exact / 31 artist)<br>Big R Radio - The Wave (`big-r-radio-the-wave`): **13** (1 exact / 12 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **4** (0 exact / 4 artist)<br>Radio Mela (`radio-mela`): **3** (1 exact / 2 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **2** (0 exact / 2 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **2** (0 exact / 2 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>PANORAMA80 (`panorama80`): **1** (0 exact / 1 artist)<br>Radio Armisa (`radio-armisa`): **1** (0 exact / 1 artist)<br>Radio FM (`radio-fm`): **1** (0 exact / 1 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>Sfliny Alternative 80's (`sfliny-alternative-80-s`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist)<br>XWave Radio (`xwave-radio`): **1** (0 exact / 1 artist) |
| 2 | David Bowie | **25** | 4 | 21 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **5** (2 exact / 3 artist)<br>Big R Radio - The Wave (`big-r-radio-the-wave`): **3** (0 exact / 3 artist)<br>KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **2** (0 exact / 2 artist)<br>RadioActive (`radioactive`): **2** (0 exact / 2 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **2** (2 exact / 0 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **2** (0 exact / 2 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>Radio Armisa (`radio-armisa`): **1** (0 exact / 1 artist)<br>Radio Mela (`radio-mela`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>RMC Voyage Voyage (`rmc-voyage-voyage`): **1** (0 exact / 1 artist)<br>Synthradio (`synthradio`): **1** (0 exact / 1 artist) |
| 3 | Dengue Fever | **23** | 0 | 23 | Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **7** (0 exact / 7 artist)<br>Radio Paradise World/ETC Mix 192k MP3 (`radio-paradise-world-etc-mix-192k-mp3`): **7** (0 exact / 7 artist)<br>Radio Paradise World/Etc Mix 320k AAC (`radio-paradise-world-etc-mix-320k-aac`): **7** (0 exact / 7 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 4 | Talking Heads | **20** | 0 | 20 | Big R Radio - The Wave (`big-r-radio-the-wave`): **7** (0 exact / 7 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (0 exact / 3 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **2** (0 exact / 2 artist)<br>Nostalgie New York (`nostalgie-new-york`): **2** (0 exact / 2 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **2** (0 exact / 2 artist)<br>KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>Radio FM (`radio-fm`): **1** (0 exact / 1 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 5 | The Cure | **20** | 0 | 20 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **6** (0 exact / 6 artist)<br>Big R Radio - The Wave (`big-r-radio-the-wave`): **3** (0 exact / 3 artist)<br>DKFM Classic (`dkfm-classic`): **3** (0 exact / 3 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **3** (0 exact / 3 artist)<br>6forty Radio (`6forty-radio`): **2** (0 exact / 2 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **2** (0 exact / 2 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist) |
| 6 | Queen | **19** | 0 | 19 | Nostalgie New York (`nostalgie-new-york`): **5** (0 exact / 5 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **3** (0 exact / 3 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **3** (0 exact / 3 artist)<br>Synthradio (`synthradio`): **2** (0 exact / 2 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **2** (0 exact / 2 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Tukker FM (`tukker-fm`): **1** (0 exact / 1 artist) |
| 7 | The Beatles | **18** | 0 | 18 | Nostalgie New York (`nostalgie-new-york`): **4** (0 exact / 4 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **4** (0 exact / 4 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **3** (0 exact / 3 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (0 exact / 3 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 8 | Thievery Corporation | **18** | 0 | 18 | Radio Paradise World/ETC Mix 192k MP3 (`radio-paradise-world-etc-mix-192k-mp3`): **5** (0 exact / 5 artist)<br>Radio Paradise World/Etc Mix 320k AAC (`radio-paradise-world-etc-mix-320k-aac`): **5** (0 exact / 5 artist)<br>Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **4** (0 exact / 4 artist)<br>Hi On Line World Radio (`hi-on-line-world-radio`): **2** (0 exact / 2 artist)<br>SWISS GROOVE (`swiss-groove`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 9 | Nirvana | **17** | 0 | 17 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **8** (0 exact / 8 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **6** (0 exact / 6 artist)<br>Nostalgie New York (`nostalgie-new-york`): **3** (0 exact / 3 artist) |
| 10 | Gong | **14** | 0 | 14 | Avant-Prog/Rock in Opposition/Canterbury Scene/Zeuhl - Radio Caprice (`avant-prog-rock-in-opposition-canterbury-scene-zeuhl-radio-caprice`): **12** (0 exact / 12 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 11 | Marvin Gaye | **14** | 0 | 14 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **5** (0 exact / 5 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **4** (0 exact / 4 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **2** (0 exact / 2 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 12 | Duran Duran | **13** | 0 | 13 | Big R Radio - The Wave (`big-r-radio-the-wave`): **6** (0 exact / 6 artist)<br>Radio Mela (`radio-mela`): **2** (0 exact / 2 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (0 exact / 1 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>Sfliny Alternative 80's (`sfliny-alternative-80-s`): **1** (0 exact / 1 artist)<br>Synthradio (`synthradio`): **1** (0 exact / 1 artist) |
| 13 | Eurythmics | **13** | 0 | 13 | Big R Radio - The Wave (`big-r-radio-the-wave`): **4** (0 exact / 4 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **2** (0 exact / 2 artist)<br>Dare-FM (`dare-fm`): **1** (0 exact / 1 artist)<br>KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>Radio Mela (`radio-mela`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist)<br>XWave Radio (`xwave-radio`): **1** (0 exact / 1 artist) |
| 14 | Pink Floyd | **13** | 2 | 11 | Nostalgie New York (`nostalgie-new-york`): **8** (1 exact / 7 artist)<br>Heavy Music Atmospheric Radio (`heavy-music-atmospheric-radio`): **2** (1 exact / 1 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 15 | Prince | **13** | 0 | 13 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist)<br>KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>Radio Mela (`radio-mela`): **1** (0 exact / 1 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>RMC Nights Story (`rmc-nights-story`): **1** (0 exact / 1 artist)<br>RMC Voyage Voyage (`rmc-voyage-voyage`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist)<br>WBEZ-HD2 "Vocalo Stream" Chicago, IL (`wbez-hd2-vocalo-stream-chicago-il`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 16 | Tears For Fears | **13** | 0 | 13 | Big R Radio - The Wave (`big-r-radio-the-wave`): **6** (0 exact / 6 artist)<br>..87,5!. Nantes (`87-5-nantes`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>Radio Mela (`radio-mela`): **1** (0 exact / 1 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>RMC Nights Story (`rmc-nights-story`): **1** (0 exact / 1 artist)<br>Synthradio (`synthradio`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 17 | Altın Gün | **12** | 3 | 9 | Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **4** (1 exact / 3 artist)<br>Radio Paradise World/Etc Mix 320k AAC (`radio-paradise-world-etc-mix-320k-aac`): **4** (1 exact / 3 artist)<br>Radio Paradise World/ETC Mix 192k MP3 (`radio-paradise-world-etc-mix-192k-mp3`): **3** (1 exact / 2 artist)<br>C Lab (`c-lab`): **1** (0 exact / 1 artist) |
| 18 | R.E.M. | **12** | 0 | 12 | Nostalgie New York (`nostalgie-new-york`): **3** (0 exact / 3 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **2** (0 exact / 2 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **2** (0 exact / 2 artist)<br>KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (0 exact / 1 artist)<br>Radio Mela (`radio-mela`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 19 | Dolly Parton | **11** | 1 | 10 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **6** (0 exact / 6 artist)<br>aNONradio (`anonradio`): **1** (1 exact / 0 artist)<br>Grolloo Radio (`grolloo-radio`): **1** (0 exact / 1 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist)<br>WUMB (`wumb`): **1** (0 exact / 1 artist) |
| 20 | Bauhaus | **9** | 0 | 9 | XWave Radio (`xwave-radio`): **6** (0 exact / 6 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>Sfliny Alternative 80's (`sfliny-alternative-80-s`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 21 | Cars | **9** | 1 | 8 | Big R Radio - The Wave (`big-r-radio-the-wave`): **8** (1 exact / 7 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 22 | Chaka Khan | **9** | 0 | 9 | RMC Nights Story (`rmc-nights-story`): **5** (0 exact / 5 artist)<br>C Lab (`c-lab`): **1** (0 exact / 1 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>Traxx FM - Cool Jam (`traxx-fm-cool-jam`): **1** (0 exact / 1 artist) |
| 23 | Fleetwood Mac | **9** | 0 | 9 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **3** (0 exact / 3 artist)<br>Nostalgie New York (`nostalgie-new-york`): **2** (0 exact / 2 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **2** (0 exact / 2 artist)<br>Radio Mela (`radio-mela`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 24 | Galaxie 500 | **9** | 1 | 8 | DKFM Classic (`dkfm-classic`): **9** (1 exact / 8 artist) |
| 25 | LADY GAGA | **9** | 0 | 9 | i love radio - greatest hits (`i-love-radio-greatest-hits`): **4** (0 exact / 4 artist)<br>..87,5!. Nantes (`87-5-nantes`): **1** (0 exact / 1 artist)<br>BANDA 93.3 (Monterrey) - 93.3 FM - XHQQ-FM - Grupo Radio Centro - Monterrey, NL (`banda-93-3-monterrey-93-3-fm-xhqq-fm-grupo-radio-centro-monterrey-nl`): **1** (0 exact / 1 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (0 exact / 1 artist)<br>Radio Armisa (`radio-armisa`): **1** (0 exact / 1 artist)<br>Star 88.8 (`star-88-8`): **1** (0 exact / 1 artist) |
| 26 | Neil Young | **8** | 0 | 8 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **2** (0 exact / 2 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 27 | Nina Simone | **8** | 0 | 8 | FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **2** (0 exact / 2 artist)<br>C Lab (`c-lab`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist)<br>SWISS GROOVE (`swiss-groove`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 28 | Russian Circles | **8** | 0 | 8 | Radio Caprice - Post-rock (`radio-caprice-post-rock`): **5** (0 exact / 5 artist)<br>6forty Radio (`6forty-radio`): **2** (0 exact / 2 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 29 | Billy Idol | **7** | 0 | 7 | Nostalgie New York (`nostalgie-new-york`): **2** (0 exact / 2 artist)<br>Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (0 exact / 1 artist)<br>KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>Radio Mela (`radio-mela`): **1** (0 exact / 1 artist)<br>Sfliny Alternative 80's (`sfliny-alternative-80-s`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 30 | Lady Gaga | **7** | 0 | 7 | i love radio - greatest hits (`i-love-radio-greatest-hits`): **3** (0 exact / 3 artist)<br>..87,5!. Nantes (`87-5-nantes`): **2** (0 exact / 2 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist) |
| 31 | Sigur Rós | **7** | 0 | 7 | Heavy Music Atmospheric Radio (`heavy-music-atmospheric-radio`): **2** (0 exact / 2 artist)<br>Radio Caprice - Post-rock (`radio-caprice-post-rock`): **2** (0 exact / 2 artist)<br>6forty Radio (`6forty-radio`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 32 | Balmorhea | **6** | 0 | 6 | Heavy Music Atmospheric Radio (`heavy-music-atmospheric-radio`): **3** (0 exact / 3 artist)<br>Radio Caprice - Post-rock (`radio-caprice-post-rock`): **3** (0 exact / 3 artist) |
| 33 | Björk | **6** | 0 | 6 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (0 exact / 3 artist)<br>RMC Nights Story (`rmc-nights-story`): **2** (0 exact / 2 artist)<br>Experimental/Avant-garde music - Radio Caprice (`experimental-avant-garde-music-radio-caprice`): **1** (0 exact / 1 artist) |
| 34 | Clark | **6** | 0 | 6 | Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **5** (0 exact / 5 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 35 | Fela Kuti | **6** | 0 | 6 | Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **2** (0 exact / 2 artist)<br>Radio Paradise World/ETC Mix 192k MP3 (`radio-paradise-world-etc-mix-192k-mp3`): **2** (0 exact / 2 artist)<br>Radio Paradise World/Etc Mix 320k AAC (`radio-paradise-world-etc-mix-320k-aac`): **2** (0 exact / 2 artist) |
| 36 | Gorillaz | **6** | 0 | 6 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist)<br>C Lab (`c-lab`): **1** (0 exact / 1 artist)<br>i love radio - greatest hits (`i-love-radio-greatest-hits`): **1** (0 exact / 1 artist)<br>open broadcast radio (`open-broadcast-radio`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 37 | Mulatu Astatke | **6** | 0 | 6 | Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **2** (0 exact / 2 artist)<br>Radio Paradise World/ETC Mix 192k MP3 (`radio-paradise-world-etc-mix-192k-mp3`): **2** (0 exact / 2 artist)<br>Radio Paradise World/Etc Mix 320k AAC (`radio-paradise-world-etc-mix-320k-aac`): **2** (0 exact / 2 artist) |
| 38 | Phil Collins | **6** | 0 | 6 | Nostalgie New York (`nostalgie-new-york`): **3** (0 exact / 3 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (0 exact / 1 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist)<br>Radio Mela (`radio-mela`): **1** (0 exact / 1 artist) |
| 39 | At the Drive‐In | **5** | 0 | 5 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (0 exact / 3 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **2** (0 exact / 2 artist) |
| 40 | Brian Jonestown Massacre | **5** | 0 | 5 | DKFM Classic (`dkfm-classic`): **5** (0 exact / 5 artist) |
| 41 | Bronski Beat | **5** | 0 | 5 | Big R Radio - The Wave (`big-r-radio-the-wave`): **4** (0 exact / 4 artist)<br>Radio Mela (`radio-mela`): **1** (0 exact / 1 artist) |
| 42 | Die Spitz | **5** | 1 | 4 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (1 exact / 2 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **2** (0 exact / 2 artist) |
| 43 | Peter Gabriel | **5** | 0 | 5 | Nostalgie New York (`nostalgie-new-york`): **2** (0 exact / 2 artist)<br>Radio FM (`radio-fm`): **1** (0 exact / 1 artist)<br>RMC Nights Story (`rmc-nights-story`): **1** (0 exact / 1 artist)<br>RMC Voyage Voyage (`rmc-voyage-voyage`): **1** (0 exact / 1 artist) |
| 44 | Steely Dan | **5** | 5 | 0 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (1 exact / 0 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (1 exact / 0 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (1 exact / 0 artist) |
| 45 | Tears for Fears | **5** | 0 | 5 | Big R Radio - The Wave (`big-r-radio-the-wave`): **3** (0 exact / 3 artist)<br>Radio FM (`radio-fm`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 46 | The Brian Jonestown Massacre | **5** | 0 | 5 | DKFM Classic (`dkfm-classic`): **3** (0 exact / 3 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 47 | The Smiths | **5** | 0 | 5 | Big R Radio - The Wave (`big-r-radio-the-wave`): **3** (0 exact / 3 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **2** (0 exact / 2 artist) |
| 48 | This Will Destroy You | **5** | 0 | 5 | Radio Caprice - Post-rock (`radio-caprice-post-rock`): **4** (0 exact / 4 artist)<br>6forty Radio (`6forty-radio`): **1** (0 exact / 1 artist) |
| 49 | Underworld | **5** | 0 | 5 | PANORAMA80 (`panorama80`): **1** (0 exact / 1 artist)<br>Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **1** (0 exact / 1 artist)<br>Radio Paradise World/ETC Mix 192k MP3 (`radio-paradise-world-etc-mix-192k-mp3`): **1** (0 exact / 1 artist)<br>Radio Paradise World/Etc Mix 320k AAC (`radio-paradise-world-etc-mix-320k-aac`): **1** (0 exact / 1 artist)<br>SomaFM Black Rock FM (128k AAC Non-SSL) (`somafm-black-rock-fm-128k-aac-non-ssl`): **1** (0 exact / 1 artist) |
| 50 | Billy Joel | **4** | 0 | 4 | Omroep Zeeland Radio (`omroep-zeeland-radio`): **2** (0 exact / 2 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist) |
| 51 | Chelsea Wolfe | **4** | 0 | 4 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **2** (0 exact / 2 artist) |
| 52 | Grateful Dead | **4** | 0 | 4 | WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **2** (0 exact / 2 artist)<br>East Tennessee's Own WDVX 89.9 FM (`east-tennessee-s-own-wdvx-89-9-fm`): **1** (0 exact / 1 artist)<br>WPKN 89.5 FM (`wpkn`): **1** (0 exact / 1 artist) |
| 53 | Khruangbin | **4** | 0 | 4 | WBEZ-HD2 "Vocalo Stream" Chicago, IL (`wbez-hd2-vocalo-stream-chicago-il`): **2** (0 exact / 2 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 54 | Kraftwerk | **4** | 0 | 4 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist)<br>Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (0 exact / 1 artist)<br>PANORAMA80 (`panorama80`): **1** (0 exact / 1 artist) |
| 55 | Maxwell | **4** | 0 | 4 | RMC Nights Story (`rmc-nights-story`): **3** (0 exact / 3 artist)<br>SWISS GROOVE (`swiss-groove`): **1** (0 exact / 1 artist) |
| 56 | MGMT | **4** | 0 | 4 | i love radio - greatest hits (`i-love-radio-greatest-hits`): **2** (0 exact / 2 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 57 | Missing Persons | **4** | 1 | 3 | Big R Radio - The Wave (`big-r-radio-the-wave`): **4** (1 exact / 3 artist) |
| 58 | Paul McCartney | **4** | 0 | 4 | Omroep Zeeland Radio (`omroep-zeeland-radio`): **2** (0 exact / 2 artist)<br>Radio Mela (`radio-mela`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 59 | Rothko | **4** | 0 | 4 | Radio Caprice - Post-rock (`radio-caprice-post-rock`): **4** (0 exact / 4 artist) |
| 60 | Tangerine Dream | **4** | 0 | 4 | Radio Caprice - Krautrock (`radio-caprice-krautrock`): **4** (0 exact / 4 artist) |
| 61 | THE ALAN PARSONS PROJECT | **4** | 0 | 4 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist) |
| 62 | The Cars | **4** | 0 | 4 | WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **3** (0 exact / 3 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist) |
| 63 | The Cranberries | **4** | 0 | 4 | Irish Pub Radio (`irish-pub-radio`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>SLOBODNÝ VYSIELAČ (`slobodn-vysiela`): **1** (0 exact / 1 artist)<br>Synthradio (`synthradio`): **1** (0 exact / 1 artist) |
| 64 | Turnstile | **4** | 0 | 4 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **2** (0 exact / 2 artist) |
| 65 | Beach Boys | **3** | 0 | 3 | Lolli Radio Happy Station (`lolli-radio-happy-station`): **3** (0 exact / 3 artist) |
| 66 | BILLY JOEL | **3** | 0 | 3 | Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **2** (0 exact / 2 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist) |
| 67 | Black Sabbath | **3** | 0 | 3 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist) |
| 68 | Bone Thugs‐n‐Harmony | **3** | 0 | 3 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 69 | Britney Spears | **3** | 0 | 3 | Lolli Radio Happy Station (`lolli-radio-happy-station`): **2** (0 exact / 2 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist) |
| 70 | Dungen | **3** | 0 | 3 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 71 | Genesis | **3** | 0 | 3 | Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist)<br>Radio Mela (`radio-mela`): **1** (0 exact / 1 artist) |
| 72 | Jim Croce | **3** | 0 | 3 | SomaFM Boot Liquor (128k AAC) (`somafm-boot-liquor-128k-aac`): **1** (0 exact / 1 artist)<br>SomaFM Boot Liquor (320k MP3) (`somafm-boot-liquor-320k-mp3`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 73 | King Gizzard & the Lizard Wizard | **3** | 0 | 3 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist) |
| 74 | MJ Lenderman | **3** | 0 | 3 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 75 | Modest Mouse | **3** | 0 | 3 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (0 exact / 3 artist) |
| 76 | Nathan Fake | **3** | 0 | 3 | dinamo.fm smog (`dinamo-fm-smog`): **2** (0 exact / 2 artist)<br>Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **1** (0 exact / 1 artist) |
| 77 | Oneohtrix Point Never | **3** | 0 | 3 | Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **3** (0 exact / 3 artist) |
| 78 | Ozzy Osbourne | **3** | 0 | 3 | Nostalgie New York (`nostalgie-new-york`): **3** (0 exact / 3 artist) |
| 79 | Protomartyr | **3** | 0 | 3 | Radio FM (`radio-fm`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 80 | ROSALÍA | **3** | 0 | 3 | Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **1** (0 exact / 1 artist)<br>Radio Paradise World/ETC Mix 192k MP3 (`radio-paradise-world-etc-mix-192k-mp3`): **1** (0 exact / 1 artist)<br>Radio Paradise World/Etc Mix 320k AAC (`radio-paradise-world-etc-mix-320k-aac`): **1** (0 exact / 1 artist) |
| 81 | Roy Orbison | **3** | 0 | 3 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist) |
| 82 | The Beach Boys | **3** | 0 | 3 | Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 83 | The The | **3** | 0 | 3 | Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Sfliny Alternative 80's (`sfliny-alternative-80-s`): **1** (0 exact / 1 artist) |
| 84 | Trentemøller | **3** | 0 | 3 | dinamo.fm smog (`dinamo-fm-smog`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 85 | Yin Yin | **3** | 0 | 3 | Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **1** (0 exact / 1 artist)<br>Radio Paradise World/ETC Mix 192k MP3 (`radio-paradise-world-etc-mix-192k-mp3`): **1** (0 exact / 1 artist)<br>Radio Paradise World/Etc Mix 320k AAC (`radio-paradise-world-etc-mix-320k-aac`): **1** (0 exact / 1 artist) |
| 86 | Arc De Soleil | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 87 | Chinese American Bear | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 88 | Counting Crows | **2** | 0 | 2 | RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>WUMB (`wumb`): **1** (0 exact / 1 artist) |
| 89 | Creedence Clearwater Revival | **2** | 0 | 2 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist) |
| 90 | Daryl Hall & John Oates | **2** | 0 | 2 | Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist)<br>Radio Mela (`radio-mela`): **1** (0 exact / 1 artist) |
| 91 | Dave Matthews Band | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 92 | DOOM GONG | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 93 | Ecce Shnak | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 94 | Emerson, Lake & Palmer | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 95 | Foo Fighters | **2** | 0 | 2 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 96 | GORILLAZ | **2** | 0 | 2 | i love radio - greatest hits (`i-love-radio-greatest-hits`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist) |
| 97 | Guns N Roses | **2** | 0 | 2 | Nostalgie New York (`nostalgie-new-york`): **2** (0 exact / 2 artist) |
| 98 | Hans Zimmer | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 99 | Heathered Pearls | **2** | 0 | 2 | dinamo.fm smog (`dinamo-fm-smog`): **1** (0 exact / 1 artist)<br>Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **1** (0 exact / 1 artist) |
| 100 | Hole | **2** | 1 | 1 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (1 exact / 0 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (0 exact / 1 artist) |
| 101 | If These Trees Could Talk | **2** | 0 | 2 | Radio Caprice - Post-rock (`radio-caprice-post-rock`): **2** (0 exact / 2 artist) |
| 102 | Jodeci | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 103 | John Maus | **2** | 0 | 2 | PANORAMA80 (`panorama80`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 104 | Journey | **2** | 0 | 2 | Nostalgie New York (`nostalgie-new-york`): **2** (0 exact / 2 artist) |
| 105 | Juana Molina | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 106 | Kikagaku Moyo | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 107 | KING CRIMSON | **2** | 0 | 2 | Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 108 | King Gizzard & The Lizard Wizard | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 109 | Low | **2** | 0 | 2 | 6forty Radio (`6forty-radio`): **2** (0 exact / 2 artist) |
| 110 | MAXWELL | **2** | 0 | 2 | Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 111 | Men I Trust | **2** | 2 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (1 exact / 0 artist) |
| 112 | Mk.gee | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 113 | Nancy Sinatra | **2** | 0 | 2 | Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist) |
| 114 | NINA SIMONE | **2** | 0 | 2 | Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 115 | Nine Inch Nails | **2** | 0 | 2 | Synthradio (`synthradio`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 116 | PETER GABRIEL | **2** | 0 | 2 | Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 117 | Poliça | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 118 | Pye Corner Audio | **2** | 0 | 2 | Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **2** (0 exact / 2 artist) |
| 119 | Red Hot Chili Peppers | **2** | 0 | 2 | Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist) |
| 120 | REM | **2** | 0 | 2 | Radio Mela (`radio-mela`): **2** (0 exact / 2 artist) |
| 121 | Smiths | **2** | 0 | 2 | Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (0 exact / 1 artist)<br>Dare-FM (`dare-fm`): **1** (0 exact / 1 artist) |
| 122 | T. Rex | **2** | 0 | 2 | Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 123 | Teddy Swims | **2** | 1 | 1 | i love radio - greatest hits (`i-love-radio-greatest-hits`): **1** (1 exact / 0 artist)<br>MFM STATION (`mfm-station`): **1** (0 exact / 1 artist) |
| 124 | THE BEATLES | **2** | 0 | 2 | Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 125 | The Replacements | **2** | 0 | 2 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 126 | The Sisters Of Mercy | **2** | 0 | 2 | Big R Radio - The Wave (`big-r-radio-the-wave`): **2** (0 exact / 2 artist) |
| 127 | Thee Oh Sees | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 128 | TOKiMONSTA | **2** | 0 | 2 | ..87,5!. Nantes (`87-5-nantes`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 129 | Wine Lips | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist) |
| 130 | Alain Goraguer | **1** | 0 | 1 | shirley & spinoza (`shirley-spinoza`): **1** (0 exact / 1 artist) |
| 131 | Amtrac | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 132 | ARC DE SOLEIL | **1** | 1 | 0 | C Lab (`c-lab`): **1** (1 exact / 0 artist) |
| 133 | Automatic | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 134 | Bananarama | **1** | 0 | 1 | Radio Mela (`radio-mela`): **1** (0 exact / 1 artist) |
| 135 | Beatles | **1** | 0 | 1 | Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist) |
| 136 | Bone Thugs-N-Harmony | **1** | 0 | 1 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist) |
| 137 | Cure | **1** | 0 | 1 | Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (0 exact / 1 artist) |
| 138 | Eighth Wonder | **1** | 0 | 1 | Radio Mela (`radio-mela`): **1** (0 exact / 1 artist) |
| 139 | Empire of the Sun | **1** | 0 | 1 | Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist) |
| 140 | FELA KUTI | **1** | 0 | 1 | C Lab (`c-lab`): **1** (0 exact / 1 artist) |
| 141 | Floating Points | **1** | 0 | 1 | dinamo.fm smog (`dinamo-fm-smog`): **1** (0 exact / 1 artist) |
| 142 | FOO FIGHTERS | **1** | 0 | 1 | Rockserwis.fm (`rockserwis-fm`): **1** (0 exact / 1 artist) |
| 143 | Forest Swords | **1** | 0 | 1 | Experimental/Avant-garde music - Radio Caprice (`experimental-avant-garde-music-radio-caprice`): **1** (0 exact / 1 artist) |
| 144 | Future Islands | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 145 | Glen Campbell | **1** | 1 | 0 | Tukker FM (`tukker-fm`): **1** (1 exact / 0 artist) |
| 146 | HEART | **1** | 0 | 1 | Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist) |
| 147 | Heart | **1** | 0 | 1 | Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist) |
| 148 | Holy Fawn | **1** | 0 | 1 | 6forty Radio (`6forty-radio`): **1** (0 exact / 1 artist) |
| 149 | ICEAGE | **1** | 0 | 1 | Radio FM (`radio-fm`): **1** (0 exact / 1 artist) |
| 150 | Jimi Hendrix | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 151 | Joe Jackson | **1** | 1 | 0 | Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (1 exact / 0 artist) |
| 152 | Kangding Ray | **1** | 0 | 1 | Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **1** (0 exact / 1 artist) |
| 153 | Kate Bush | **1** | 0 | 1 | Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (0 exact / 1 artist) |
| 154 | KHRUANGBIN | **1** | 0 | 1 | C Lab (`c-lab`): **1** (0 exact / 1 artist) |
| 155 | King Harvest | **1** | 1 | 0 | Nostalgie New York (`nostalgie-new-york`): **1** (1 exact / 0 artist) |
| 156 | Kodomo | **1** | 0 | 1 | SomaFM Black Rock FM (128k AAC Non-SSL) (`somafm-black-rock-fm-128k-aac-non-ssl`): **1** (0 exact / 1 artist) |
| 157 | KOKOROKO | **1** | 1 | 0 | Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **1** (1 exact / 0 artist) |
| 158 | La Luz | **1** | 0 | 1 | FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist) |
| 159 | Manuel Göttsching | **1** | 0 | 1 | Radio Caprice - Krautrock (`radio-caprice-krautrock`): **1** (0 exact / 1 artist) |
| 160 | Momma | **1** | 0 | 1 | WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 161 | Morrissey | **1** | 0 | 1 | Radio Mela (`radio-mela`): **1** (0 exact / 1 artist) |
| 162 | Mr.Kitty | **1** | 0 | 1 | Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **1** (0 exact / 1 artist) |
| 163 | Murcof | **1** | 0 | 1 | dinamo.fm smog (`dinamo-fm-smog`): **1** (0 exact / 1 artist) |
| 164 | Nothing But Thieves | **1** | 0 | 1 | Synthradio (`synthradio`): **1** (0 exact / 1 artist) |
| 165 | Pearl Jam | **1** | 0 | 1 | Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist) |
| 166 | Pelican | **1** | 0 | 1 | 6forty Radio (`6forty-radio`): **1** (0 exact / 1 artist) |
| 167 | PHIL COLLINS | **1** | 0 | 1 | Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 168 | Pjusk | **1** | 0 | 1 | Experimental/Avant-garde music - Radio Caprice (`experimental-avant-garde-music-radio-caprice`): **1** (0 exact / 1 artist) |
| 169 | Public Image LTD. | **1** | 1 | 0 | Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (1 exact / 0 artist) |
| 170 | Public Service Broadcasting | **1** | 0 | 1 | Synthradio (`synthradio`): **1** (0 exact / 1 artist) |
| 171 | Ratatat | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 172 | RED HOT CHILI PEPPERS | **1** | 0 | 1 | Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist) |
| 173 | Sade | **1** | 1 | 0 | Nostalgie New York (`nostalgie-new-york`): **1** (1 exact / 0 artist) |
| 174 | Shaboozey | **1** | 1 | 0 | Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (1 exact / 0 artist) |
| 175 | Shed | **1** | 0 | 1 | Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **1** (0 exact / 1 artist) |
| 176 | Smashing Pumpkins | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 177 | Son Lux | **1** | 0 | 1 | Experimental/Avant-garde music - Radio Caprice (`experimental-avant-garde-music-radio-caprice`): **1** (0 exact / 1 artist) |
| 178 | Soul Coughing | **1** | 0 | 1 | WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 179 | Steve Miller Band | **1** | 0 | 1 | Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 180 | TEMPLES | **1** | 1 | 0 | Radio FM (`radio-fm`): **1** (1 exact / 0 artist) |
| 181 | The Alan Parsons Project | **1** | 0 | 1 | Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist) |
| 182 | The Band | **1** | 0 | 1 | Grolloo Radio (`grolloo-radio`): **1** (0 exact / 1 artist) |
| 183 | The Body | **1** | 0 | 1 | DJ 666 Geordieblackcore (`dj-666-geordieblackcore`): **1** (0 exact / 1 artist) |
| 184 | THE CACTUS CHANNEL | **1** | 1 | 0 | C Lab (`c-lab`): **1** (1 exact / 0 artist) |
| 185 | The Divine Comedy | **1** | 0 | 1 | Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist) |
| 186 | The Eagles | **1** | 0 | 1 | WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 187 | The Meters | **1** | 1 | 0 | Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (1 exact / 0 artist) |
| 188 | The Observers | **1** | 0 | 1 | shirley & spinoza (`shirley-spinoza`): **1** (0 exact / 1 artist) |
| 189 | The Sisters of Mercy | **1** | 0 | 1 | Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (0 exact / 1 artist) |
| 190 | THE SMITHS | **1** | 0 | 1 | Radio FM (`radio-fm`): **1** (0 exact / 1 artist) |
| 191 | The Temptations | **1** | 1 | 0 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (1 exact / 0 artist) |
| 192 | Tiffany | **1** | 0 | 1 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist) |
| 193 | Tim Hecker | **1** | 0 | 1 | Experimental/Avant-garde music - Radio Caprice (`experimental-avant-garde-music-radio-caprice`): **1** (0 exact / 1 artist) |
| 194 | TOBACCO | **1** | 1 | 0 | Radio FM (`radio-fm`): **1** (1 exact / 0 artist) |
| 195 | Tokimonsta | **1** | 0 | 1 | Experimental/Avant-garde music - Radio Caprice (`experimental-avant-garde-music-radio-caprice`): **1** (0 exact / 1 artist) |
| 196 | Tom Tom Club | **1** | 1 | 0 | Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (1 exact / 0 artist) |
| 197 | Tommy Guerrero | **1** | 0 | 1 | C Lab (`c-lab`): **1** (0 exact / 1 artist) |
| 198 | Ulver | **1** | 0 | 1 | Experimental/Avant-garde music - Radio Caprice (`experimental-avant-garde-music-radio-caprice`): **1** (0 exact / 1 artist) |
| 199 | Viagra Boys | **1** | 1 | 0 | WPKN 89.5 FM (`wpkn`): **1** (1 exact / 0 artist) |
| 200 | Waveshaper | **1** | 0 | 1 | Nightride FM - Datawave (`nightride-fm-datawave`): **1** (0 exact / 1 artist) |
| 201 | Wucan | **1** | 0 | 1 | Radio Caprice - Krautrock (`radio-caprice-krautrock`): **1** (0 exact / 1 artist) |

# Lifetime

## Ambient

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | Phil Collins | **37** | 0 | 37 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **20** (0 exact / 20 artist)<br>Candelight (`candelight`): **15** (0 exact / 15 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **2** (0 exact / 2 artist) |
| 2 | The Beatles | **32** | 0 | 32 | Candelight (`candelight`): **13** (0 exact / 13 artist)<br>- 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **11** (0 exact / 11 artist)<br>Laut.FM Shoegaze (`laut-fm-shoegaze`): **5** (0 exact / 5 artist)<br>NEU RADIO (`neu-radio`): **3** (0 exact / 3 artist) |
| 3 | Oneohtrix Point Never | **29** | 0 | 29 | ISEKOI Radio \| Non-Stop Ambient (`isekoi-radio-non-stop-ambient`): **24** (0 exact / 24 artist)<br>NEU RADIO (`neu-radio`): **3** (0 exact / 3 artist)<br>Radio Caprice: Ambient (`radio-caprice-ambient`): **2** (0 exact / 2 artist) |
| 4 | Tim Hecker | **27** | 4 | 23 | ISEKOI Radio \| Non-Stop Ambient (`isekoi-radio-non-stop-ambient`): **22** (4 exact / 18 artist)<br>Culture Failure (`culture-failure`): **3** (0 exact / 3 artist)<br>SomaFM Mission Control (128k MP3) (`somafm-mission-control-128k-mp3`): **1** (0 exact / 1 artist)<br>Traxx FM - Ambient (`traxx-fm-ambient`): **1** (0 exact / 1 artist) |
| 5 | Queen | **23** | 0 | 23 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **15** (0 exact / 15 artist)<br>- 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **4** (0 exact / 4 artist)<br>Candelight (`candelight`): **4** (0 exact / 4 artist) |
| 6 | Genesis | **22** | 0 | 22 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **9** (0 exact / 9 artist)<br>Candelight (`candelight`): **7** (0 exact / 7 artist)<br>- 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **5** (0 exact / 5 artist)<br>Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 7 | Jon Hopkins | **19** | 0 | 19 | Radio Caprice: Ambient (`radio-caprice-ambient`): **4** (0 exact / 4 artist)<br>SomaFM SF 10-33 (128k MP3) (`somafm-sf-10-33-128k-mp3`): **4** (0 exact / 4 artist)<br>SomaFM DEF CON Radio (128k AAC) (`somafm-def-con-radio-128k-aac`): **3** (0 exact / 3 artist)<br>SomaFM Mission Control (128k MP3) (`somafm-mission-control-128k-mp3`): **3** (0 exact / 3 artist)<br>dinamo.fm sleep (`dinamo-fm-sleep`): **1** (0 exact / 1 artist)<br>Journeyscapes Radio (`journeyscapes-radio`): **1** (0 exact / 1 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist)<br>NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist)<br>Planet Ambi HD (`planet-ambi-hd`): **1** (0 exact / 1 artist) |
| 8 | Tangerine Dream | **18** | 0 | 18 | Echoes of Bluemars (`echoes-of-bluemars`): **4** (0 exact / 4 artist)<br>Radio Caprice: Ambient (`radio-caprice-ambient`): **3** (0 exact / 3 artist)<br>Seven Rays - 7rays (`seven-rays-7rays`): **3** (0 exact / 3 artist)<br>Journeyscapes Radio (`journeyscapes-radio`): **2** (0 exact / 2 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **2** (0 exact / 2 artist)<br>AmbientRadio (MRG.fm) (`ambientradio-mrg-fm`): **1** (0 exact / 1 artist)<br>Cryosleep (`cryosleep`): **1** (0 exact / 1 artist)<br>Culture Failure (`culture-failure`): **1** (0 exact / 1 artist)<br>Hirschmilch Radio (`hirschmilch-radio`): **1** (0 exact / 1 artist) |
| 9 | Fleetwood Mac | **16** | 0 | 16 | Candelight (`candelight`): **13** (0 exact / 13 artist)<br>- 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist)<br>Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist) |
| 10 | Billy Joel | **15** | 0 | 15 | Candelight (`candelight`): **9** (0 exact / 9 artist)<br>- 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **6** (0 exact / 6 artist) |
| 11 | R.E.M. | **13** | 0 | 13 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **8** (0 exact / 8 artist)<br>Candelight (`candelight`): **2** (0 exact / 2 artist)<br>NEU RADIO (`neu-radio`): **2** (0 exact / 2 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist) |
| 12 | Tears For Fears | **11** | 1 | 10 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **6** (1 exact / 5 artist)<br>Candelight (`candelight`): **3** (0 exact / 3 artist)<br>- 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **2** (0 exact / 2 artist) |
| 13 | Prince | **10** | 0 | 10 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **5** (0 exact / 5 artist)<br>Candelight (`candelight`): **3** (0 exact / 3 artist)<br>100% ACID JAZZ (`100-acid-jazz`): **2** (0 exact / 2 artist) |
| 14 | The Beach Boys | **10** | 0 | 10 | Candelight (`candelight`): **5** (0 exact / 5 artist)<br>- 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **2** (0 exact / 2 artist)<br>Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist)<br>NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 15 | Heathered Pearls | **9** | 0 | 9 | SomaFM SF 10-33 (128k MP3) (`somafm-sf-10-33-128k-mp3`): **3** (0 exact / 3 artist)<br>Planet Ambi HD (`planet-ambi-hd`): **2** (0 exact / 2 artist)<br>SomaFM DEF CON Radio (128k AAC) (`somafm-def-con-radio-128k-aac`): **2** (0 exact / 2 artist)<br>dinamo.fm sleep (`dinamo-fm-sleep`): **1** (0 exact / 1 artist)<br>SomaFM Mission Control (128k MP3) (`somafm-mission-control-128k-mp3`): **1** (0 exact / 1 artist) |
| 16 | Murcof | **8** | 0 | 8 | SomaFM SF 10-33 (128k MP3) (`somafm-sf-10-33-128k-mp3`): **4** (0 exact / 4 artist)<br>SomaFM Mission Control (128k MP3) (`somafm-mission-control-128k-mp3`): **3** (0 exact / 3 artist)<br>SomaFM Deep Space One (128k MP3) (`somafm-deep-space-one-128k-mp3`): **1** (0 exact / 1 artist) |
| 17 | Eurythmics | **7** | 0 | 7 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **5** (0 exact / 5 artist)<br>Candelight (`candelight`): **1** (0 exact / 1 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist) |
| 18 | Thievery Corporation | **7** | 0 | 7 | SomaFM DEF CON Radio (128k AAC) (`somafm-def-con-radio-128k-aac`): **3** (0 exact / 3 artist)<br>Groove Wave Lounge (`groove-wave-lounge`): **2** (0 exact / 2 artist)<br>181.FM - Chilled Out (USA) 128k mp3 (`181-fm-chilled-out-usa-128k-mp3`): **1** (0 exact / 1 artist)<br>SomaFM Secret Agent (128k MP3) (`somafm-secret-agent-128k-mp3`): **1** (0 exact / 1 artist) |
| 19 | Depeche Mode | **6** | 1 | 5 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (1 exact / 0 artist)<br>181.FM - Chilled Out (USA) 128k mp3 (`181-fm-chilled-out-usa-128k-mp3`): **1** (0 exact / 1 artist)<br>Ambiento (`ambiento`): **1** (0 exact / 1 artist)<br>Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist)<br>NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 20 | Kate Bush | **6** | 3 | 3 | Candelight (`candelight`): **4** (1 exact / 3 artist)<br>- 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (1 exact / 0 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (1 exact / 0 artist) |
| 21 | Kraftwerk | **6** | 0 | 6 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **5** (0 exact / 5 artist)<br>NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 22 | Billy Idol | **5** | 0 | 5 | Candelight (`candelight`): **2** (0 exact / 2 artist)<br>Laut.FM Shoegaze (`laut-fm-shoegaze`): **2** (0 exact / 2 artist)<br>- 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist) |
| 23 | Britney Spears | **5** | 0 | 5 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **5** (0 exact / 5 artist) |
| 24 | Duran Duran | **5** | 0 | 5 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **2** (0 exact / 2 artist)<br>- 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist)<br>Candelight (`candelight`): **1** (0 exact / 1 artist)<br>Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 25 | Marvin Gaye | **5** | 0 | 5 | Candelight (`candelight`): **5** (0 exact / 5 artist) |
| 26 | Neil Young | **5** | 0 | 5 | Candelight (`candelight`): **3** (0 exact / 3 artist)<br>- 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist)<br>Fluid Radio (`fluid-radio`): **1** (0 exact / 1 artist) |
| 27 | Peter Gabriel | **5** | 0 | 5 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **3** (0 exact / 3 artist)<br>Candelight (`candelight`): **2** (0 exact / 2 artist) |
| 28 | Sofie Birch | **5** | 0 | 5 | ISEKOI Radio \| Non-Stop Ambient (`isekoi-radio-non-stop-ambient`): **5** (0 exact / 5 artist) |
| 29 | Bauhaus | **4** | 0 | 4 | SomaFM Doomed (256k MP3) (`somafm-doomed-256k-mp3`): **3** (0 exact / 3 artist)<br>NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 30 | Beach House | **4** | 0 | 4 | 181.FM - Chilled Out (USA) 128k mp3 (`181-fm-chilled-out-usa-128k-mp3`): **2** (0 exact / 2 artist)<br>Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist)<br>NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 31 | David Bowie | **4** | 0 | 4 | Candelight (`candelight`): **2** (0 exact / 2 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist)<br>NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 32 | Floating Points | **4** | 0 | 4 | SomaFM Mission Control (128k MP3) (`somafm-mission-control-128k-mp3`): **2** (0 exact / 2 artist)<br>SomaFM Deep Space One (128k MP3) (`somafm-deep-space-one-128k-mp3`): **1** (0 exact / 1 artist)<br>SomaFM SF 10-33 (128k MP3) (`somafm-sf-10-33-128k-mp3`): **1** (0 exact / 1 artist) |
| 33 | Hans Zimmer | **4** | 0 | 4 | Fluid Radio (`fluid-radio`): **2** (0 exact / 2 artist)<br>Seven Rays - 7rays (`seven-rays-7rays`): **2** (0 exact / 2 artist) |
| 34 | Jim Croce | **4** | 0 | 4 | Candelight (`candelight`): **4** (0 exact / 4 artist) |
| 35 | Morrissey | **4** | 0 | 4 | NEU RADIO (`neu-radio`): **4** (0 exact / 4 artist) |
| 36 | Teebs | **4** | 0 | 4 | SomaFM DEF CON Radio (128k AAC) (`somafm-def-con-radio-128k-aac`): **3** (0 exact / 3 artist)<br>NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 37 | The Alan Parsons Project | **4** | 0 | 4 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **2** (0 exact / 2 artist)<br>Candelight (`candelight`): **1** (0 exact / 1 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist) |
| 38 | The Black Dog | **4** | 0 | 4 | dinamo.fm sleep (`dinamo-fm-sleep`): **3** (0 exact / 3 artist)<br>SomaFM DEF CON Radio (128k AAC) (`somafm-def-con-radio-128k-aac`): **1** (0 exact / 1 artist) |
| 39 | The Cars | **4** | 0 | 4 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist)<br>Candelight (`candelight`): **1** (0 exact / 1 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist)<br>NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 40 | The Cure | **4** | 0 | 4 | NEU RADIO (`neu-radio`): **2** (0 exact / 2 artist)<br>- 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist)<br>Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 41 | (ghost) | **3** | 0 | 3 | SomaFM n5MD (128k AAC) (`somafm-n5md-128k-aac`): **3** (0 exact / 3 artist) |
| 42 | A Perfect Circle | **3** | 0 | 3 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **3** (0 exact / 3 artist) |
| 43 | Alan Parsons Project | **3** | 0 | 3 | Candelight (`candelight`): **2** (0 exact / 2 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist) |
| 44 | Björk | **3** | 0 | 3 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist)<br>NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist)<br>SomaFM DEF CON Radio (128k AAC) (`somafm-def-con-radio-128k-aac`): **1** (0 exact / 1 artist) |
| 45 | Empire of the Sun | **3** | 0 | 3 | SomaFM DEF CON Radio (128k AAC) (`somafm-def-con-radio-128k-aac`): **2** (0 exact / 2 artist)<br>- 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist) |
| 46 | Heart | **3** | 2 | 1 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **2** (1 exact / 1 artist)<br>Candelight (`candelight`): **1** (1 exact / 0 artist) |
| 47 | Khruangbin | **3** | 1 | 2 | NEU RADIO (`neu-radio`): **3** (1 exact / 2 artist) |
| 48 | Lady Gaga | **3** | 0 | 3 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **3** (0 exact / 3 artist) |
| 49 | Mazzy Star | **3** | 3 | 0 | 181.FM - Chilled Out (USA) 128k mp3 (`181-fm-chilled-out-usa-128k-mp3`): **1** (1 exact / 0 artist)<br>Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (1 exact / 0 artist)<br>NEU RADIO (`neu-radio`): **1** (1 exact / 0 artist) |
| 50 | Nina Simone | **3** | 0 | 3 | NEU RADIO (`neu-radio`): **3** (0 exact / 3 artist) |
| 51 | ODESZA | **3** | 0 | 3 | SomaFM DEF CON Radio (128k AAC) (`somafm-def-con-radio-128k-aac`): **3** (0 exact / 3 artist) |
| 52 | Surprise Chef | **3** | 2 | 1 | NEU RADIO (`neu-radio`): **3** (2 exact / 1 artist) |
| 53 | Underworld | **3** | 0 | 3 | SomaFM DEF CON Radio (128k AAC) (`somafm-def-con-radio-128k-aac`): **2** (0 exact / 2 artist)<br>Culture Failure (`culture-failure`): **1** (0 exact / 1 artist) |
| 54 | Beach Boys | **2** | 0 | 2 | Candelight (`candelight`): **1** (0 exact / 1 artist)<br>Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 55 | BILLY JOEL | **2** | 0 | 2 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist) |
| 56 | Bronski Beat | **2** | 1 | 1 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **2** (1 exact / 1 artist) |
| 57 | Clark | **2** | 0 | 2 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist)<br>SomaFM SF 10-33 (128k MP3) (`somafm-sf-10-33-128k-mp3`): **1** (0 exact / 1 artist) |
| 58 | Eagles | **2** | 0 | 2 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **2** (0 exact / 2 artist) |
| 59 | Fiction Factory | **2** | 2 | 0 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (1 exact / 0 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (1 exact / 0 artist) |
| 60 | Gorillaz | **2** | 0 | 2 | 181.FM - Chilled Out (USA) 128k mp3 (`181-fm-chilled-out-usa-128k-mp3`): **2** (0 exact / 2 artist) |
| 61 | Janko Nilovic | **2** | 0 | 2 | SomaFM Secret Agent (128k MP3) (`somafm-secret-agent-128k-mp3`): **2** (0 exact / 2 artist) |
| 62 | Jimi Hendrix | **2** | 0 | 2 | Candelight (`candelight`): **2** (0 exact / 2 artist) |
| 63 | Journey | **2** | 1 | 1 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (1 exact / 0 artist) |
| 64 | Khan | **2** | 0 | 2 | NEU RADIO (`neu-radio`): **2** (0 exact / 2 artist) |
| 65 | Kodomo | **2** | 0 | 2 | SomaFM DEF CON Radio (128k AAC) (`somafm-def-con-radio-128k-aac`): **2** (0 exact / 2 artist) |
| 66 | LADY GAGA | **2** | 0 | 2 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist)<br>Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 67 | Max Cooper | **2** | 0 | 2 | SomaFM DEF CON Radio (128k AAC) (`somafm-def-con-radio-128k-aac`): **2** (0 exact / 2 artist) |
| 68 | MGMT | **2** | 0 | 2 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist) |
| 69 | Modest Mouse | **2** | 0 | 2 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **2** (0 exact / 2 artist) |
| 70 | Nathan Fake | **2** | 0 | 2 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist)<br>SomaFM DEF CON Radio (128k AAC) (`somafm-def-con-radio-128k-aac`): **1** (0 exact / 1 artist) |
| 71 | Nine Inch Nails | **2** | 0 | 2 | CoSTa's Ambient Radio (`costa-s-ambient-radio`): **1** (0 exact / 1 artist)<br>Echoes of Bluemars (`echoes-of-bluemars`): **1** (0 exact / 1 artist) |
| 72 | Paul McCartney | **2** | 0 | 2 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist)<br>Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 73 | Pink Floyd | **2** | 0 | 2 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist) |
| 74 | Red Hot Chili Peppers | **2** | 0 | 2 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist)<br>Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 75 | Steely Dan | **2** | 2 | 0 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **2** (2 exact / 0 artist) |
| 76 | The Cranberries | **2** | 0 | 2 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist)<br>Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 77 | The Smiths | **2** | 0 | 2 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **2** (0 exact / 2 artist) |
| 78 | Thomas Fehlmann | **2** | 0 | 2 | Ambient Modern (`ambient-modern`): **1** (0 exact / 1 artist)<br>dinamo.fm sleep (`dinamo-fm-sleep`): **1** (0 exact / 1 artist) |
| 79 | TOMAGA | **2** | 0 | 2 | SomaFM Mission Control (128k MP3) (`somafm-mission-control-128k-mp3`): **1** (0 exact / 1 artist)<br>SomaFM SF 10-33 (128k MP3) (`somafm-sf-10-33-128k-mp3`): **1** (0 exact / 1 artist) |
| 80 | Whitney Houston | **2** | 2 | 0 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (1 exact / 0 artist)<br>Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (1 exact / 0 artist) |
| 81 | Abul Mogard | **1** | 0 | 1 | dinamo.fm sleep (`dinamo-fm-sleep`): **1** (0 exact / 1 artist) |
| 82 | Anthony Linell | **1** | 0 | 1 | CoSTa's Ambient Radio (`costa-s-ambient-radio`): **1** (0 exact / 1 artist) |
| 83 | At the Drive‐In | **1** | 0 | 1 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 84 | Bananarama | **1** | 1 | 0 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (1 exact / 0 artist) |
| 85 | Beatles | **1** | 0 | 1 | Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 86 | beatles | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 87 | Black Sabbath | **1** | 0 | 1 | SomaFM Doomed (256k MP3) (`somafm-doomed-256k-mp3`): **1** (0 exact / 1 artist) |
| 88 | Bloc Party | **1** | 1 | 0 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (1 exact / 0 artist) |
| 89 | Blood Orange | **1** | 1 | 0 | 181.FM - Chilled Out (USA) 128k mp3 (`181-fm-chilled-out-usa-128k-mp3`): **1** (1 exact / 0 artist) |
| 90 | Bob Marley & The Wailers | **1** | 0 | 1 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 91 | Caterina Barbieri | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 92 | Chaka Khan | **1** | 0 | 1 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist) |
| 93 | Chromeo | **1** | 1 | 0 | NEU RADIO (`neu-radio`): **1** (1 exact / 0 artist) |
| 94 | Creedence Clearwater Revival | **1** | 0 | 1 | Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 95 | Cure | **1** | 0 | 1 | SomaFM Doomed (256k MP3) (`somafm-doomed-256k-mp3`): **1** (0 exact / 1 artist) |
| 96 | Deathprod | **1** | 1 | 0 | RADCAP: INDUSTRIAL / DARK / RITUAL AMBIENT (`radcap-industrial-dark-ritual-ambient`): **1** (1 exact / 0 artist) |
| 97 | Deerhoof | **1** | 1 | 0 | NEU RADIO (`neu-radio`): **1** (1 exact / 0 artist) |
| 98 | Deftones | **1** | 0 | 1 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 99 | Dehd | **1** | 1 | 0 | NEU RADIO (`neu-radio`): **1** (1 exact / 0 artist) |
| 100 | Dirty Projectors | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 101 | Dolly Parton | **1** | 1 | 0 | Candelight (`candelight`): **1** (1 exact / 0 artist) |
| 102 | Don Henley | **1** | 0 | 1 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist) |
| 103 | Ekin Fil | **1** | 1 | 0 | dinamo.fm sleep (`dinamo-fm-sleep`): **1** (1 exact / 0 artist) |
| 104 | Everything Everything | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 105 | Fela Kuti | **1** | 1 | 0 | NEU RADIO (`neu-radio`): **1** (1 exact / 0 artist) |
| 106 | Felicia Atkinson | **1** | 0 | 1 | dinamo.fm sleep (`dinamo-fm-sleep`): **1** (0 exact / 1 artist) |
| 107 | Foo Fighters | **1** | 0 | 1 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 108 | Forest Swords | **1** | 0 | 1 | SomaFM DEF CON Radio (128k AAC) (`somafm-def-con-radio-128k-aac`): **1** (0 exact / 1 artist) |
| 109 | Félicia Atkinson | **1** | 1 | 0 | Fluid Radio (`fluid-radio`): **1** (1 exact / 0 artist) |
| 110 | Goldfrapp | **1** | 1 | 0 | NEU RADIO (`neu-radio`): **1** (1 exact / 0 artist) |
| 111 | Harald Grosskopf | **1** | 1 | 0 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (1 exact / 0 artist) |
| 112 | HEALTH | **1** | 0 | 1 | 181.FM - Chilled Out (USA) 128k mp3 (`181-fm-chilled-out-usa-128k-mp3`): **1** (0 exact / 1 artist) |
| 113 | Hole | **1** | 1 | 0 | NEU RADIO (`neu-radio`): **1** (1 exact / 0 artist) |
| 114 | KOKOROKO | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 115 | Lee Paradise | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 116 | Mulatu Astatke | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 117 | Nancy Sinatra | **1** | 0 | 1 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist) |
| 118 | Neu! | **1** | 1 | 0 | NEU RADIO (`neu-radio`): **1** (1 exact / 0 artist) |
| 119 | Nirvana | **1** | 0 | 1 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 120 | Ozzy Osbourne | **1** | 0 | 1 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist) |
| 121 | Panda Bear | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 122 | Pat Benatar | **1** | 0 | 1 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist) |
| 123 | Peter Schilling | **1** | 1 | 0 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (1 exact / 0 artist) |
| 124 | PHIL COLLINS | **1** | 0 | 1 | Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 125 | Pjusk | **1** | 0 | 1 | AmbientRadio (MRG.fm) (`ambientradio-mrg-fm`): **1** (0 exact / 1 artist) |
| 126 | POLIÇA | **1** | 0 | 1 | 181.FM - Chilled Out (USA) 128k mp3 (`181-fm-chilled-out-usa-128k-mp3`): **1** (0 exact / 1 artist) |
| 127 | Poliça | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 128 | Pye Corner Audio | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 129 | QUEEN | **1** | 0 | 1 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist) |
| 130 | Ready for the World | **1** | 1 | 0 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (1 exact / 0 artist) |
| 131 | Righteous Brothers | **1** | 0 | 1 | Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 132 | Robbie Robertson | **1** | 1 | 0 | Candelight (`candelight`): **1** (1 exact / 0 artist) |
| 133 | Rothko | **1** | 0 | 1 | Culture Failure (`culture-failure`): **1** (0 exact / 1 artist) |
| 134 | RÜFÜS DU SOL | **1** | 1 | 0 | AIRPORT LOUNGE RADIO (`airport-lounge-radio`): **1** (1 exact / 0 artist) |
| 135 | Sigur Rós | **1** | 0 | 1 | dinamo.fm sleep (`dinamo-fm-sleep`): **1** (0 exact / 1 artist) |
| 136 | Squid | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 137 | T. Rex | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 138 | Taleen Kali | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 139 | Teddy Swims | **1** | 1 | 0 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (1 exact / 0 artist) |
| 140 | Temples | **1** | 0 | 1 | 181.FM - Chilled Out (USA) 128k mp3 (`181-fm-chilled-out-usa-128k-mp3`): **1** (0 exact / 1 artist) |
| 141 | THE ALAN PARSONS PROJECT | **1** | 0 | 1 | - 1 A - Relax von 1A Radio (`1-a-relax-von-1a-radio`): **1** (0 exact / 1 artist) |
| 142 | The Clean | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 143 | The Field | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 144 | The Foundations | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 145 | The Nude Party | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 146 | The Replacements | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 147 | The Righteous Brothers | **1** | 0 | 1 | Candelight (`candelight`): **1** (0 exact / 1 artist) |
| 148 | The Sisters Of Mercy | **1** | 0 | 1 | CoSTa's Ambient Radio (`costa-s-ambient-radio`): **1** (0 exact / 1 artist) |
| 149 | The Smashing Pumpkins | **1** | 0 | 1 | Laut.FM Shoegaze (`laut-fm-shoegaze`): **1** (0 exact / 1 artist) |
| 150 | THE SMITHS | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 151 | The The | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 152 | Thundercat | **1** | 1 | 0 | 100% ACID JAZZ (`100-acid-jazz`): **1** (1 exact / 0 artist) |
| 153 | Tiffany | **1** | 0 | 1 | Laut.FM Synthesizer Greatest (`laut-fm-synthesizer-greatest`): **1** (0 exact / 1 artist) |
| 154 | TOKiMONSTA | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 155 | Tom Petty | **1** | 1 | 0 | Candelight (`candelight`): **1** (1 exact / 0 artist) |
| 156 | Tomasz Bednarczyk | **1** | 0 | 1 | Radio Caprice: Ambient (`radio-caprice-ambient`): **1** (0 exact / 1 artist) |
| 157 | Tony Allen | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 158 | Trentemøller | **1** | 0 | 1 | SomaFM DEF CON Radio (128k AAC) (`somafm-def-con-radio-128k-aac`): **1** (0 exact / 1 artist) |
| 159 | Waveshaper | **1** | 0 | 1 | SomaFM DEF CON Radio (128k AAC) (`somafm-def-con-radio-128k-aac`): **1** (0 exact / 1 artist) |
| 160 | Woods | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |
| 161 | Yeah Yeah Yeahs | **1** | 1 | 0 | 181.FM - Chilled Out (USA) 128k mp3 (`181-fm-chilled-out-usa-128k-mp3`): **1** (1 exact / 0 artist) |
| 162 | Yin Yin | **1** | 0 | 1 | NEU RADIO (`neu-radio`): **1** (0 exact / 1 artist) |

## Campus

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | Dolly Parton | **106** | 4 | 102 | WKCR 89.9 FM (`wkcr`): **38** (1 exact / 37 artist)<br>KALX 90.7 FM (`kalx`): **16** (1 exact / 15 artist)<br>WPRB 103.3 FM (`wprb`): **13** (0 exact / 13 artist)<br>WMFO 91.5 FM (`wmfo`): **11** (1 exact / 10 artist)<br>KVSC 88.1 FM (`kvsc`): **8** (0 exact / 8 artist)<br>KDVS 90.3 FM (`kdvs`): **7** (0 exact / 7 artist)<br>KXLU 88.9 FM (`kxlu`): **5** (0 exact / 5 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **3** (1 exact / 2 artist)<br>CJSR 88.5 FM (`cjsr`): **1** (0 exact / 1 artist)<br>WBRS 100.1 FM (`wbrs`): **1** (0 exact / 1 artist)<br>WHRB 95.3 FM (`whrb`): **1** (0 exact / 1 artist)<br>WUOG 90.5 FM (`wuog`): **1** (0 exact / 1 artist)<br>WXYC 89.3 FM (`wxyc`): **1** (0 exact / 1 artist) |
| 2 | The Beatles | **32** | 1 | 31 | WMFO 91.5 FM (`wmfo`): **18** (0 exact / 18 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **9** (0 exact / 9 artist)<br>KUCR 88.3 FM (`kucr`): **2** (0 exact / 2 artist)<br>WBRS 100.1 FM (`wbrs`): **2** (1 exact / 1 artist)<br>WRCT 88.3 FM (`wrct`): **1** (0 exact / 1 artist) |
| 3 | David Bowie | **29** | 3 | 26 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **18** (1 exact / 17 artist)<br>KUCR 88.3 FM (`kucr`): **2** (0 exact / 2 artist)<br>WMFO 91.5 FM (`wmfo`): **2** (0 exact / 2 artist)<br>WPRB 103.3 FM (`wprb`): **2** (1 exact / 1 artist)<br>KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist)<br>KSJS 90.5 FM (`ksjs`): **1** (0 exact / 1 artist)<br>KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist)<br>KXLU 88.9 FM (`kxlu`): **1** (1 exact / 0 artist)<br>WBRS 100.1 FM (`wbrs`): **1** (0 exact / 1 artist) |
| 4 | The Cure | **26** | 0 | 26 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **12** (0 exact / 12 artist)<br>KVSC 88.1 FM (`kvsc`): **6** (0 exact / 6 artist)<br>KDVS 90.3 FM (`kdvs`): **3** (0 exact / 3 artist)<br>WRCT 88.3 FM (`wrct`): **2** (0 exact / 2 artist)<br>KXLU 88.9 FM (`kxlu`): **1** (0 exact / 1 artist)<br>WLUW 88.7 FM (`wluw`): **1** (0 exact / 1 artist)<br>WXYC 89.3 FM (`wxyc`): **1** (0 exact / 1 artist) |
| 5 | R.E.M. | **25** | 0 | 25 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **17** (0 exact / 17 artist)<br>KVSC 88.1 FM (`kvsc`): **4** (0 exact / 4 artist)<br>WMFO 91.5 FM (`wmfo`): **2** (0 exact / 2 artist)<br>WUOG 90.5 FM (`wuog`): **2** (0 exact / 2 artist) |
| 6 | Talking Heads | **22** | 0 | 22 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **15** (0 exact / 15 artist)<br>KXLU 88.9 FM (`kxlu`): **2** (0 exact / 2 artist)<br>KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist)<br>KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist)<br>WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist)<br>WUOG 90.5 FM (`wuog`): **1** (0 exact / 1 artist)<br>WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 7 | Depeche Mode | **18** | 2 | 16 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **14** (2 exact / 12 artist)<br>KVSC 88.1 FM (`kvsc`): **2** (0 exact / 2 artist)<br>KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist)<br>KUCR 88.3 FM (`kucr`): **1** (0 exact / 1 artist) |
| 8 | Gorillaz | **15** | 0 | 15 | WMFO 91.5 FM (`wmfo`): **10** (0 exact / 10 artist)<br>KDVS 90.3 FM (`kdvs`): **2** (0 exact / 2 artist)<br>KVSC 88.1 FM (`kvsc`): **2** (0 exact / 2 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 9 | Modest Mouse | **15** | 1 | 14 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **7** (0 exact / 7 artist)<br>KVSC 88.1 FM (`kvsc`): **6** (1 exact / 5 artist)<br>KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist)<br>WHRB 95.3 FM (`whrb`): **1** (0 exact / 1 artist) |
| 10 | Jimi Hendrix | **14** | 0 | 14 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **4** (0 exact / 4 artist)<br>KDVS 90.3 FM (`kdvs`): **3** (0 exact / 3 artist)<br>KALX 90.7 FM (`kalx`): **2** (0 exact / 2 artist)<br>WRCT 88.3 FM (`wrct`): **2** (0 exact / 2 artist)<br>KXLU 88.9 FM (`kxlu`): **1** (0 exact / 1 artist)<br>WBRS 100.1 FM (`wbrs`): **1** (0 exact / 1 artist)<br>WESU 88.1 FM (`wesu`): **1** (0 exact / 1 artist) |
| 11 | Kate Bush | **14** | 3 | 11 | WMFO 91.5 FM (`wmfo`): **10** (2 exact / 8 artist)<br>KDVS 90.3 FM (`kdvs`): **2** (0 exact / 2 artist)<br>KVSC 88.1 FM (`kvsc`): **2** (1 exact / 1 artist) |
| 12 | Nirvana | **14** | 0 | 14 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **8** (0 exact / 8 artist)<br>KVSC 88.1 FM (`kvsc`): **4** (0 exact / 4 artist)<br>KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist)<br>WRCT 88.3 FM (`wrct`): **1** (0 exact / 1 artist) |
| 13 | Neil Young | **13** | 0 | 13 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **7** (0 exact / 7 artist)<br>WMFO 91.5 FM (`wmfo`): **3** (0 exact / 3 artist)<br>KALX 90.7 FM (`kalx`): **2** (0 exact / 2 artist)<br>WBRS 100.1 FM (`wbrs`): **1** (0 exact / 1 artist) |
| 14 | Björk | **10** | 0 | 10 | KDVS 90.3 FM (`kdvs`): **3** (0 exact / 3 artist)<br>KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist)<br>KSJS 90.5 FM (`ksjs`): **1** (0 exact / 1 artist)<br>WHRB 95.3 FM (`whrb`): **1** (0 exact / 1 artist)<br>WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist)<br>WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist)<br>WUOG 90.5 FM (`wuog`): **1** (0 exact / 1 artist) |
| 15 | The Replacements | **10** | 1 | 9 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **4** (0 exact / 4 artist)<br>KVSC 88.1 FM (`kvsc`): **3** (0 exact / 3 artist)<br>KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist)<br>WHRB 95.3 FM (`whrb`): **1** (0 exact / 1 artist)<br>WZBC 90.3 FM (`wzbc`): **1** (1 exact / 0 artist) |
| 16 | The Smashing Pumpkins | **10** | 0 | 10 | KVSC 88.1 FM (`kvsc`): **7** (0 exact / 7 artist)<br>KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist)<br>WICB 91.7 FM (`wicb`): **1** (0 exact / 1 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 17 | The Smiths | **10** | 0 | 10 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **7** (0 exact / 7 artist)<br>KVSC 88.1 FM (`kvsc`): **2** (0 exact / 2 artist)<br>WXYC 89.3 FM (`wxyc`): **1** (0 exact / 1 artist) |
| 18 | Foo Fighters | **9** | 0 | 9 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **6** (0 exact / 6 artist)<br>WBRS 100.1 FM (`wbrs`): **1** (0 exact / 1 artist)<br>WICB 91.7 FM (`wicb`): **1** (0 exact / 1 artist)<br>WRCT 88.3 FM (`wrct`): **1** (0 exact / 1 artist) |
| 19 | Marvin Gaye | **9** | 0 | 9 | WMFO 91.5 FM (`wmfo`): **3** (0 exact / 3 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **3** (0 exact / 3 artist)<br>KCSM 91.1 FM (`kcsm`): **1** (0 exact / 1 artist)<br>KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist)<br>KUCR 88.3 FM (`kucr`): **1** (0 exact / 1 artist) |
| 20 | Prince | **9** | 2 | 7 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **4** (1 exact / 3 artist)<br>KDVS 90.3 FM (`kdvs`): **2** (1 exact / 1 artist)<br>KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist)<br>WBRS 100.1 FM (`wbrs`): **1** (0 exact / 1 artist)<br>WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 21 | The Cars | **9** | 1 | 8 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **4** (1 exact / 3 artist)<br>WRCT 88.3 FM (`wrct`): **3** (0 exact / 3 artist)<br>KXLU 88.9 FM (`kxlu`): **1** (0 exact / 1 artist)<br>WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 22 | Ween | **9** | 0 | 9 | KVSC 88.1 FM (`kvsc`): **3** (0 exact / 3 artist)<br>WMFO 91.5 FM (`wmfo`): **3** (0 exact / 3 artist)<br>WUOG 90.5 FM (`wuog`): **2** (0 exact / 2 artist)<br>WRCT 88.3 FM (`wrct`): **1** (0 exact / 1 artist) |
| 23 | Hole | **8** | 3 | 5 | KDVS 90.3 FM (`kdvs`): **3** (0 exact / 3 artist)<br>KVSC 88.1 FM (`kvsc`): **2** (1 exact / 1 artist)<br>WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (1 exact / 0 artist)<br>WZBC 90.3 FM (`wzbc`): **1** (1 exact / 0 artist) |
| 24 | La Luz | **8** | 0 | 8 | KALX 90.7 FM (`kalx`): **4** (0 exact / 4 artist)<br>KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist)<br>KSJS 90.5 FM (`ksjs`): **1** (0 exact / 1 artist)<br>WBRS 100.1 FM (`wbrs`): **1** (0 exact / 1 artist)<br>WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 25 | MGMT | **8** | 1 | 7 | WMFO 91.5 FM (`wmfo`): **5** (1 exact / 4 artist)<br>KVSC 88.1 FM (`kvsc`): **2** (0 exact / 2 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 26 | Mk.gee | **8** | 1 | 7 | WKCR 89.9 FM (`wkcr`): **6** (1 exact / 5 artist)<br>KXLU 88.9 FM (`kxlu`): **1** (0 exact / 1 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 27 | The The | **8** | 3 | 5 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **5** (1 exact / 4 artist)<br>KDVS 90.3 FM (`kdvs`): **1** (1 exact / 0 artist)<br>KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist)<br>WZBC 90.3 FM (`wzbc`): **1** (1 exact / 0 artist) |
| 28 | Chelsea Wolfe | **7** | 0 | 7 | CJSR 88.5 FM (`cjsr`): **3** (0 exact / 3 artist)<br>KVSC 88.1 FM (`kvsc`): **2** (0 exact / 2 artist)<br>WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist)<br>WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 29 | Grateful Dead | **7** | 0 | 7 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **5** (0 exact / 5 artist)<br>KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist)<br>WESU 88.1 FM (`wesu`): **1** (0 exact / 1 artist) |
| 30 | Holy Wave | **7** | 0 | 7 | KALX 90.7 FM (`kalx`): **3** (0 exact / 3 artist)<br>KVSC 88.1 FM (`kvsc`): **2** (0 exact / 2 artist)<br>WZBC 90.3 FM (`wzbc`): **2** (0 exact / 2 artist) |
| 31 | Morrissey | **7** | 0 | 7 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **6** (0 exact / 6 artist)<br>WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 32 | Oneohtrix Point Never | **7** | 0 | 7 | WKCR 89.9 FM (`wkcr`): **2** (0 exact / 2 artist)<br>WZBC 90.3 FM (`wzbc`): **2** (0 exact / 2 artist)<br>KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist)<br>KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist)<br>WRCT 88.3 FM (`wrct`): **1** (0 exact / 1 artist) |
| 33 | SLIFT | **7** | 0 | 7 | CJSR 88.5 FM (`cjsr`): **4** (0 exact / 4 artist)<br>KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist)<br>KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist)<br>WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 34 | The Beach Boys | **7** | 0 | 7 | WBRS 100.1 FM (`wbrs`): **3** (0 exact / 3 artist)<br>KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist)<br>WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist)<br>WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 35 | The Cranberries | **7** | 0 | 7 | WMFO 91.5 FM (`wmfo`): **3** (0 exact / 3 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **2** (0 exact / 2 artist)<br>WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist)<br>WRCT 88.3 FM (`wrct`): **1** (0 exact / 1 artist) |
| 36 | Thee Oh Sees | **7** | 0 | 7 | WZBC 90.3 FM (`wzbc`): **5** (0 exact / 5 artist)<br>WBRS 100.1 FM (`wbrs`): **1** (0 exact / 1 artist)<br>WHRB 95.3 FM (`whrb`): **1** (0 exact / 1 artist) |
| 37 | Turnstile | **7** | 1 | 6 | WLUW 88.7 FM (`wluw`): **2** (0 exact / 2 artist)<br>WMFO 91.5 FM (`wmfo`): **2** (1 exact / 1 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **2** (0 exact / 2 artist)<br>KSJS 90.5 FM (`ksjs`): **1** (0 exact / 1 artist) |
| 38 | Billy Joel | **6** | 0 | 6 | WBRS 100.1 FM (`wbrs`): **4** (0 exact / 4 artist)<br>WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist)<br>WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 39 | Black Sabbath | **6** | 0 | 6 | WRCT 88.3 FM (`wrct`): **2** (0 exact / 2 artist)<br>KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist)<br>WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist)<br>WUOG 90.5 FM (`wuog`): **1** (0 exact / 1 artist) |
| 40 | Deerhoof | **6** | 1 | 5 | WZBC 90.3 FM (`wzbc`): **2** (0 exact / 2 artist)<br>KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist)<br>KVSC 88.1 FM (`kvsc`): **1** (1 exact / 0 artist)<br>WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist)<br>WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 41 | Khruangbin | **6** | 0 | 6 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **3** (0 exact / 3 artist)<br>WLUW 88.7 FM (`wluw`): **2** (0 exact / 2 artist)<br>WKCR 89.9 FM (`wkcr`): **1** (0 exact / 1 artist) |
| 42 | Nina Simone | **6** | 0 | 6 | KDVS 90.3 FM (`kdvs`): **3** (0 exact / 3 artist)<br>WKCR 89.9 FM (`wkcr`): **1** (0 exact / 1 artist)<br>WLUW 88.7 FM (`wluw`): **1** (0 exact / 1 artist)<br>WRCT 88.3 FM (`wrct`): **1** (0 exact / 1 artist) |
| 43 | Peter Gabriel | **6** | 0 | 6 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **5** (0 exact / 5 artist)<br>KXLU 88.9 FM (`kxlu`): **1** (0 exact / 1 artist) |
| 44 | Protomartyr | **6** | 0 | 6 | WBRS 100.1 FM (`wbrs`): **3** (0 exact / 3 artist)<br>KUCR 88.3 FM (`kucr`): **1** (0 exact / 1 artist)<br>WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist)<br>WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 45 | The Brian Jonestown Massacre | **6** | 0 | 6 | WZBC 90.3 FM (`wzbc`): **3** (0 exact / 3 artist)<br>WPRB 103.3 FM (`wprb`): **2** (0 exact / 2 artist)<br>WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 46 | Castle Rat | **5** | 1 | 4 | CJSR 88.5 FM (`cjsr`): **3** (1 exact / 2 artist)<br>WRCT 88.3 FM (`wrct`): **2** (0 exact / 2 artist) |
| 47 | Chinese American Bear | **5** | 3 | 2 | WMFO 91.5 FM (`wmfo`): **3** (1 exact / 2 artist)<br>KALX 90.7 FM (`kalx`): **1** (1 exact / 0 artist)<br>KVSC 88.1 FM (`kvsc`): **1** (1 exact / 0 artist) |
| 48 | Counting Crows | **5** | 0 | 5 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **3** (0 exact / 3 artist)<br>KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist)<br>WBRS 100.1 FM (`wbrs`): **1** (0 exact / 1 artist) |
| 49 | Deftones | **5** | 1 | 4 | KDVS 90.3 FM (`kdvs`): **2** (0 exact / 2 artist)<br>KSJS 90.5 FM (`ksjs`): **1** (0 exact / 1 artist)<br>WBRS 100.1 FM (`wbrs`): **1** (0 exact / 1 artist)<br>WRCT 88.3 FM (`wrct`): **1** (1 exact / 0 artist) |
| 50 | Fela Kuti | **5** | 1 | 4 | WUOG 90.5 FM (`wuog`): **2** (1 exact / 1 artist)<br>KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist)<br>KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist)<br>WKCR 89.9 FM (`wkcr`): **1** (0 exact / 1 artist) |
| 51 | King Crimson | **5** | 0 | 5 | KALX 90.7 FM (`kalx`): **2** (0 exact / 2 artist)<br>KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist)<br>KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist)<br>WRCT 88.3 FM (`wrct`): **1** (0 exact / 1 artist) |
| 52 | Lady Gaga | **5** | 0 | 5 | WMFO 91.5 FM (`wmfo`): **3** (0 exact / 3 artist)<br>WBRS 100.1 FM (`wbrs`): **2** (0 exact / 2 artist) |
| 53 | MJ Lenderman | **5** | 0 | 5 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **2** (0 exact / 2 artist)<br>WUOG 90.5 FM (`wuog`): **2** (0 exact / 2 artist)<br>KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist) |
| 54 | Patsy Cline | **5** | 0 | 5 | WBRS 100.1 FM (`wbrs`): **2** (0 exact / 2 artist)<br>WKCR 89.9 FM (`wkcr`): **2** (0 exact / 2 artist)<br>KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist) |
| 55 | Soul Coughing | **5** | 0 | 5 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **4** (0 exact / 4 artist)<br>KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist) |
| 56 | The Band | **5** | 0 | 5 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **2** (0 exact / 2 artist)<br>CJSR 88.5 FM (`cjsr`): **1** (0 exact / 1 artist)<br>WESU 88.1 FM (`wesu`): **1** (0 exact / 1 artist)<br>WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 57 | Title Fight | **5** | 0 | 5 | KDVS 90.3 FM (`kdvs`): **2** (0 exact / 2 artist)<br>WUOG 90.5 FM (`wuog`): **2** (0 exact / 2 artist)<br>KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist) |
| 58 | All Them Witches | **4** | 0 | 4 | KVSC 88.1 FM (`kvsc`): **4** (0 exact / 4 artist) |
| 59 | Bauhaus | **4** | 0 | 4 | KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist)<br>KXLU 88.9 FM (`kxlu`): **1** (0 exact / 1 artist)<br>WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist)<br>WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 60 | Duran Duran | **4** | 0 | 4 | KVSC 88.1 FM (`kvsc`): **2** (0 exact / 2 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist)<br>WXYC 89.3 FM (`wxyc`): **1** (0 exact / 1 artist) |
| 61 | Floating Points | **4** | 0 | 4 | WKCR 89.9 FM (`wkcr`): **4** (0 exact / 4 artist) |
| 62 | Future Islands | **4** | 0 | 4 | KVSC 88.1 FM (`kvsc`): **3** (0 exact / 3 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 63 | Galaxie 500 | **4** | 0 | 4 | WPRB 103.3 FM (`wprb`): **2** (0 exact / 2 artist)<br>KXLU 88.9 FM (`kxlu`): **1** (0 exact / 1 artist)<br>WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 64 | Gong | **4** | 0 | 4 | KSJS 90.5 FM (`ksjs`): **1** (0 exact / 1 artist)<br>WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist)<br>WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist)<br>WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 65 | Hum | **4** | 0 | 4 | KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist)<br>KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist)<br>WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist)<br>WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 66 | Iceage | **4** | 0 | 4 | KVSC 88.1 FM (`kvsc`): **2** (0 exact / 2 artist)<br>CJSR 88.5 FM (`cjsr`): **1** (0 exact / 1 artist)<br>WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 67 | Low | **4** | 0 | 4 | KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist)<br>KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist)<br>WUOG 90.5 FM (`wuog`): **1** (0 exact / 1 artist)<br>WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 68 | Momma | **4** | 0 | 4 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **3** (0 exact / 3 artist)<br>WXYC 89.3 FM (`wxyc`): **1** (0 exact / 1 artist) |
| 69 | Paul McCartney | **4** | 0 | 4 | KUCR 88.3 FM (`kucr`): **1** (0 exact / 1 artist)<br>WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist)<br>WRCT 88.3 FM (`wrct`): **1** (0 exact / 1 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 70 | Pelican | **4** | 0 | 4 | WPRB 103.3 FM (`wprb`): **3** (0 exact / 3 artist)<br>WRCT 88.3 FM (`wrct`): **1** (0 exact / 1 artist) |
| 71 | Queen | **4** | 1 | 3 | WHRB 95.3 FM (`whrb`): **1** (0 exact / 1 artist)<br>WICB 91.7 FM (`wicb`): **1** (0 exact / 1 artist)<br>WMFO 91.5 FM (`wmfo`): **1** (1 exact / 0 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 72 | Steely Dan | **4** | 3 | 1 | KCSM 91.1 FM (`kcsm`): **1** (1 exact / 0 artist)<br>WESU 88.1 FM (`wesu`): **1** (1 exact / 0 artist)<br>WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (1 exact / 0 artist) |
| 73 | Tim Hecker | **4** | 0 | 4 | KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist)<br>WHRB 95.3 FM (`whrb`): **1** (0 exact / 1 artist)<br>WXYC 89.3 FM (`wxyc`): **1** (0 exact / 1 artist)<br>WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 74 | Beach Fossils | **3** | 0 | 3 | WBRS 100.1 FM (`wbrs`): **2** (0 exact / 2 artist)<br>WUOG 90.5 FM (`wuog`): **1** (0 exact / 1 artist) |
| 75 | Beach House | **3** | 0 | 3 | KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist)<br>KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist)<br>WKCR 89.9 FM (`wkcr`): **1** (0 exact / 1 artist) |
| 76 | Boards of Canada | **3** | 3 | 0 | KALX 90.7 FM (`kalx`): **1** (1 exact / 0 artist)<br>KDVS 90.3 FM (`kdvs`): **1** (1 exact / 0 artist)<br>WMFO 91.5 FM (`wmfo`): **1** (1 exact / 0 artist) |
| 77 | Britney Spears | **3** | 0 | 3 | KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist)<br>KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist)<br>WBRS 100.1 FM (`wbrs`): **1** (0 exact / 1 artist) |
| 78 | Crosby, Stills, Nash & Young | **3** | 0 | 3 | WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist)<br>WRCT 88.3 FM (`wrct`): **1** (0 exact / 1 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 79 | Dave Matthews Band | **3** | 0 | 3 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **3** (0 exact / 3 artist) |
| 80 | Dick Dale | **3** | 0 | 3 | KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist)<br>WHRB 95.3 FM (`whrb`): **1** (0 exact / 1 artist)<br>WRCT 88.3 FM (`wrct`): **1** (0 exact / 1 artist) |
| 81 | Discovery Zone | **3** | 0 | 3 | KALX 90.7 FM (`kalx`): **2** (0 exact / 2 artist)<br>WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 82 | Fleetwood Mac | **3** | 0 | 3 | WMFO 91.5 FM (`wmfo`): **2** (0 exact / 2 artist)<br>WXYC 89.3 FM (`wxyc`): **1** (0 exact / 1 artist) |
| 83 | Kraftwerk | **3** | 0 | 3 | WHRB 95.3 FM (`whrb`): **2** (0 exact / 2 artist)<br>WXYC 89.3 FM (`wxyc`): **1** (0 exact / 1 artist) |
| 84 | Pearl Jam | **3** | 0 | 3 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **2** (0 exact / 2 artist)<br>WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 85 | Pink Floyd | **3** | 1 | 2 | KDVS 90.3 FM (`kdvs`): **2** (1 exact / 1 artist)<br>WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 86 | Red Hot Chili Peppers | **3** | 0 | 3 | KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist)<br>KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist)<br>WICB 91.7 FM (`wicb`): **1** (0 exact / 1 artist) |
| 87 | ROSALÍA | **3** | 0 | 3 | KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist)<br>WKCR 89.9 FM (`wkcr`): **1** (0 exact / 1 artist)<br>WRCT 88.3 FM (`wrct`): **1** (0 exact / 1 artist) |
| 88 | Rush | **3** | 0 | 3 | KALX 90.7 FM (`kalx`): **2** (0 exact / 2 artist)<br>WRCT 88.3 FM (`wrct`): **1** (0 exact / 1 artist) |
| 89 | T. Rex | **3** | 0 | 3 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **3** (0 exact / 3 artist) |
| 90 | Tears For Fears | **3** | 1 | 2 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **3** (1 exact / 2 artist) |
| 91 | The Claypool Lennon Delirium | **3** | 2 | 1 | CJSR 88.5 FM (`cjsr`): **1** (1 exact / 0 artist)<br>KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (1 exact / 0 artist) |
| 92 | The Clean | **3** | 0 | 3 | KXLU 88.9 FM (`kxlu`): **1** (0 exact / 1 artist)<br>WHRB 95.3 FM (`whrb`): **1** (0 exact / 1 artist)<br>WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 93 | They Are Gutting a Body of Water | **3** | 0 | 3 | KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist)<br>KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist)<br>WLUW 88.7 FM (`wluw`): **1** (0 exact / 1 artist) |
| 94 | Yin Yin | **3** | 0 | 3 | KALX 90.7 FM (`kalx`): **2** (0 exact / 2 artist)<br>WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 95 | At the Drive-In | **2** | 0 | 2 | KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist)<br>KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist) |
| 96 | Billy Idol | **2** | 0 | 2 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist)<br>WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 97 | Blood Orange | **2** | 2 | 0 | KVSC 88.1 FM (`kvsc`): **1** (1 exact / 0 artist)<br>WMFO 91.5 FM (`wmfo`): **1** (1 exact / 0 artist) |
| 98 | Broadcast | **2** | 1 | 1 | KDVS 90.3 FM (`kdvs`): **1** (1 exact / 0 artist)<br>WBRS 100.1 FM (`wbrs`): **1** (0 exact / 1 artist) |
| 99 | Clark | **2** | 0 | 2 | WRCT 88.3 FM (`wrct`): **1** (0 exact / 1 artist)<br>WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 100 | Creedence Clearwater Revival | **2** | 1 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **2** (1 exact / 1 artist) |
| 101 | David Byrne | **2** | 0 | 2 | KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 102 | Dead Meadow | **2** | 0 | 2 | WZBC 90.3 FM (`wzbc`): **2** (0 exact / 2 artist) |
| 103 | Eagles | **2** | 0 | 2 | WESU 88.1 FM (`wesu`): **1** (0 exact / 1 artist)<br>WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 104 | Ed O’Brien | **2** | 0 | 2 | KVSC 88.1 FM (`kvsc`): **2** (0 exact / 2 artist) |
| 105 | Elephant Stone | **2** | 0 | 2 | WLUW 88.7 FM (`wluw`): **1** (0 exact / 1 artist)<br>WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 106 | Empire of the Sun | **2** | 0 | 2 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist)<br>WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 107 | G. Love | **2** | 0 | 2 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **2** (0 exact / 2 artist) |
| 108 | Genesis | **2** | 0 | 2 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist)<br>WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 109 | Genesis Owusu | **2** | 2 | 0 | KVSC 88.1 FM (`kvsc`): **1** (1 exact / 0 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (1 exact / 0 artist) |
| 110 | Greensky Bluegrass | **2** | 0 | 2 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **2** (0 exact / 2 artist) |
| 111 | Kaitlyn Aurelia Smith | **2** | 0 | 2 | KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist)<br>WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 112 | King Woman | **2** | 0 | 2 | KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist)<br>WLUW 88.7 FM (`wluw`): **1** (0 exact / 1 artist) |
| 113 | Loathe | **2** | 0 | 2 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist)<br>WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 114 | Max Cooper | **2** | 0 | 2 | WZBC 90.3 FM (`wzbc`): **2** (0 exact / 2 artist) |
| 115 | Ozzy Osbourne | **2** | 0 | 2 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist)<br>WRCT 88.3 FM (`wrct`): **1** (0 exact / 1 artist) |
| 116 | Pile | **2** | 0 | 2 | KXLU 88.9 FM (`kxlu`): **1** (0 exact / 1 artist)<br>WHRB 95.3 FM (`whrb`): **1** (0 exact / 1 artist) |
| 117 | Pixies | **2** | 2 | 0 | KVSC 88.1 FM (`kvsc`): **1** (1 exact / 0 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (1 exact / 0 artist) |
| 118 | Psychedelic Porn Crumpets | **2** | 0 | 2 | KXLU 88.9 FM (`kxlu`): **1** (0 exact / 1 artist)<br>WRCT 88.3 FM (`wrct`): **1** (0 exact / 1 artist) |
| 119 | Smashing Pumpkins | **2** | 0 | 2 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **2** (0 exact / 2 artist) |
| 120 | Sofie Birch | **2** | 0 | 2 | WPRB 103.3 FM (`wprb`): **2** (0 exact / 2 artist) |
| 121 | Squid | **2** | 1 | 1 | WLUW 88.7 FM (`wluw`): **1** (1 exact / 0 artist)<br>WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 122 | T Rex | **2** | 1 | 1 | WPRB 103.3 FM (`wprb`): **2** (1 exact / 1 artist) |
| 123 | Tangerine Dream | **2** | 0 | 2 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist)<br>WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 124 | The Blue Nile | **2** | 1 | 1 | KALX 90.7 FM (`kalx`): **1** (1 exact / 0 artist)<br>KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist) |
| 125 | The Brothers Johnson | **2** | 2 | 0 | KDVS 90.3 FM (`kdvs`): **1** (1 exact / 0 artist)<br>WRCT 88.3 FM (`wrct`): **1** (1 exact / 0 artist) |
| 126 | The Mars Volta | **2** | 0 | 2 | WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 127 | The Nude Party | **2** | 0 | 2 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **2** (0 exact / 2 artist) |
| 128 | The Psychedelic Furs | **2** | 2 | 0 | KALX 90.7 FM (`kalx`): **1** (1 exact / 0 artist)<br>KUCR 88.3 FM (`kucr`): **1** (1 exact / 0 artist) |
| 129 | The Wallflowers | **2** | 0 | 2 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **2** (0 exact / 2 artist) |
| 130 | Thievery Corporation | **2** | 0 | 2 | KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist)<br>WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 131 | Tom Tom Club | **2** | 2 | 0 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (1 exact / 0 artist)<br>WZBC 90.3 FM (`wzbc`): **1** (1 exact / 0 artist) |
| 132 | Trans Am | **2** | 0 | 2 | WHRB 95.3 FM (`whrb`): **1** (0 exact / 1 artist)<br>WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 133 | Ty Segall | **2** | 2 | 0 | WESU 88.1 FM (`wesu`): **1** (1 exact / 0 artist)<br>WZBC 90.3 FM (`wzbc`): **1** (1 exact / 0 artist) |
| 134 | Viagra Boys | **2** | 1 | 1 | KVSC 88.1 FM (`kvsc`): **1** (1 exact / 0 artist)<br>WLUW 88.7 FM (`wluw`): **1** (0 exact / 1 artist) |
| 135 | Wine Lips | **2** | 0 | 2 | CJSR 88.5 FM (`cjsr`): **1** (0 exact / 1 artist)<br>WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 136 | A/lpaca | **1** | 0 | 1 | WLUW 88.7 FM (`wluw`): **1** (0 exact / 1 artist) |
| 137 | Astrid Sonne | **1** | 0 | 1 | KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist) |
| 138 | Belly | **1** | 1 | 0 | KVSC 88.1 FM (`kvsc`): **1** (1 exact / 0 artist) |
| 139 | BILLY JOEL | **1** | 0 | 1 | WBRS 100.1 FM (`wbrs`): **1** (0 exact / 1 artist) |
| 140 | Bloc Party | **1** | 1 | 0 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (1 exact / 0 artist) |
| 141 | Bob Marley & The Wailers | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 142 | Bodega | **1** | 0 | 1 | WBRS 100.1 FM (`wbrs`): **1** (0 exact / 1 artist) |
| 143 | Bootsy Collins | **1** | 1 | 0 | KSJS 90.5 FM (`ksjs`): **1** (1 exact / 0 artist) |
| 144 | Bruce Hornsby | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 145 | Cannons | **1** | 1 | 0 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (1 exact / 0 artist) |
| 146 | Caterina Barbieri | **1** | 0 | 1 | WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 147 | Chaka Khan | **1** | 0 | 1 | KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist) |
| 148 | Cheekface | **1** | 1 | 0 | KVSC 88.1 FM (`kvsc`): **1** (1 exact / 0 artist) |
| 149 | Cola | **1** | 1 | 0 | WLUW 88.7 FM (`wluw`): **1** (1 exact / 0 artist) |
| 150 | Cyndi Lauper | **1** | 1 | 0 | WPRB 103.3 FM (`wprb`): **1** (1 exact / 0 artist) |
| 151 | Dan Deacon | **1** | 1 | 0 | WPRB 103.3 FM (`wprb`): **1** (1 exact / 0 artist) |
| 152 | Darksoft | **1** | 0 | 1 | WLUW 88.7 FM (`wluw`): **1** (0 exact / 1 artist) |
| 153 | Deafheaven | **1** | 0 | 1 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist) |
| 154 | Dehd | **1** | 1 | 0 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (1 exact / 0 artist) |
| 155 | Die Spitz | **1** | 0 | 1 | WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 156 | Dirty Projectors | **1** | 0 | 1 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist) |
| 157 | Don Henley | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 158 | Drugdealer | **1** | 0 | 1 | KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist) |
| 159 | Dylan Henner | **1** | 0 | 1 | WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 160 | Eurythmics | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 161 | Farm | **1** | 1 | 0 | WMFO 91.5 FM (`wmfo`): **1** (1 exact / 0 artist) |
| 162 | Father John Misty | **1** | 1 | 0 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (1 exact / 0 artist) |
| 163 | Forest Swords | **1** | 0 | 1 | WLUW 88.7 FM (`wluw`): **1** (0 exact / 1 artist) |
| 164 | FuzZ | **1** | 0 | 1 | WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 165 | Fuzz | **1** | 1 | 0 | WUOG 90.5 FM (`wuog`): **1** (1 exact / 0 artist) |
| 166 | Ghost | **1** | 0 | 1 | WHRB 95.3 FM (`whrb`): **1** (0 exact / 1 artist) |
| 167 | Glen Campbell | **1** | 0 | 1 | WKCR 89.9 FM (`wkcr`): **1** (0 exact / 1 artist) |
| 168 | GoGo Penguin | **1** | 0 | 1 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist) |
| 169 | GORILLAZ | **1** | 0 | 1 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 170 | Graham Nash | **1** | 0 | 1 | WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 171 | Heart | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 172 | ICEAGE | **1** | 0 | 1 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist) |
| 173 | iceage | **1** | 0 | 1 | KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist) |
| 174 | James Gang | **1** | 0 | 1 | KXLU 88.9 FM (`kxlu`): **1** (0 exact / 1 artist) |
| 175 | Jessica Lea Mayfield | **1** | 0 | 1 | KXLU 88.9 FM (`kxlu`): **1** (0 exact / 1 artist) |
| 176 | Jim Croce | **1** | 0 | 1 | KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist) |
| 177 | John Maus | **1** | 0 | 1 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist) |
| 178 | Journey | **1** | 0 | 1 | KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist) |
| 179 | Juana Molina | **1** | 0 | 1 | KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist) |
| 180 | Judas Priest | **1** | 0 | 1 | WRCT 88.3 FM (`wrct`): **1** (0 exact / 1 artist) |
| 181 | Karnivool | **1** | 0 | 1 | WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 182 | Kikagaku Moyo | **1** | 0 | 1 | WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 183 | Lo Moon | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 184 | Lusine | **1** | 1 | 0 | WXYC 89.3 FM (`wxyc`): **1** (1 exact / 0 artist) |
| 185 | Makthaverskan | **1** | 1 | 0 | WHRB 95.3 FM (`whrb`): **1** (1 exact / 0 artist) |
| 186 | Maxwell | **1** | 0 | 1 | KSJS 90.5 FM (`ksjs`): **1** (0 exact / 1 artist) |
| 187 | Mazzy Star | **1** | 1 | 0 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (1 exact / 0 artist) |
| 188 | Men I Trust | **1** | 1 | 0 | WPRB 103.3 FM (`wprb`): **1** (1 exact / 0 artist) |
| 189 | Missing Persons | **1** | 1 | 0 | KDVS 90.3 FM (`kdvs`): **1** (1 exact / 0 artist) |
| 190 | Molly Tuttle | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 191 | Mr. Bungle | **1** | 0 | 1 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist) |
| 192 | Mr.Kitty | **1** | 0 | 1 | WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 193 | Mulatu Astatke | **1** | 0 | 1 | KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist) |
| 194 | Nala Sinephro | **1** | 1 | 0 | WKCR 89.9 FM (`wkcr`): **1** (1 exact / 0 artist) |
| 195 | NEIL YOUNG | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 196 | Nilüfer Yanya | **1** | 0 | 1 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 197 | NINA SIMONE | **1** | 0 | 1 | WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 198 | Nine Inch Nails | **1** | 0 | 1 | WRCT 88.3 FM (`wrct`): **1** (0 exact / 1 artist) |
| 199 | Noonday Underground | **1** | 0 | 1 | WMFO 91.5 FM (`wmfo`): **1** (0 exact / 1 artist) |
| 200 | Pete Townshend | **1** | 1 | 0 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (1 exact / 0 artist) |
| 201 | PETER GABRIEL | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 202 | Police | **1** | 1 | 0 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (1 exact / 0 artist) |
| 203 | Public Service Broadcasting | **1** | 0 | 1 | KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist) |
| 204 | Pye Corner Audio | **1** | 0 | 1 | WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 205 | Robbie Robertson | **1** | 1 | 0 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (1 exact / 0 artist) |
| 206 | Russian Circles | **1** | 0 | 1 | WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 207 | Ryuichi Sakamoto | **1** | 1 | 0 | WKCR 89.9 FM (`wkcr`): **1** (1 exact / 0 artist) |
| 208 | Salem | **1** | 1 | 0 | KSJS 90.5 FM (`ksjs`): **1** (1 exact / 0 artist) |
| 209 | Savatage | **1** | 0 | 1 | WESU 88.1 FM (`wesu`): **1** (0 exact / 1 artist) |
| 210 | Sea Wolf | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 211 | Sinead O'Connor | **1** | 1 | 0 | KDVS 90.3 FM (`kdvs`): **1** (1 exact / 0 artist) |
| 212 | Sleep | **1** | 0 | 1 | WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 213 | Slint | **1** | 1 | 0 | KVSC 88.1 FM (`kvsc`): **1** (1 exact / 0 artist) |
| 214 | Slothrust | **1** | 0 | 1 | WLUW 88.7 FM (`wluw`): **1** (0 exact / 1 artist) |
| 215 | snuggle | **1** | 1 | 0 | KALX 90.7 FM (`kalx`): **1** (1 exact / 0 artist) |
| 216 | Soft Kill | **1** | 0 | 1 | KXLU 88.9 FM (`kxlu`): **1** (0 exact / 1 artist) |
| 217 | Spaceslug | **1** | 1 | 0 | WZBC 90.3 FM (`wzbc`): **1** (1 exact / 0 artist) |
| 218 | St. Paul & The Broken Bones | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 219 | Suicide | **1** | 1 | 0 | WZBC 90.3 FM (`wzbc`): **1** (1 exact / 0 artist) |
| 220 | Superheaven | **1** | 0 | 1 | WLUW 88.7 FM (`wluw`): **1** (0 exact / 1 artist) |
| 221 | T REX | **1** | 1 | 0 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (1 exact / 0 artist) |
| 222 | T-Rex | **1** | 0 | 1 | KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist) |
| 223 | T.S.O.L. | **1** | 1 | 0 | KDVS 90.3 FM (`kdvs`): **1** (1 exact / 0 artist) |
| 224 | Teddy Swims | **1** | 1 | 0 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (1 exact / 0 artist) |
| 225 | TEMPLES | **1** | 1 | 0 | WZBC 90.3 FM (`wzbc`): **1** (1 exact / 0 artist) |
| 226 | Temples | **1** | 0 | 1 | WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 227 | The Alan Parsons Project | **1** | 0 | 1 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist) |
| 228 | The Black Angels | **1** | 0 | 1 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist) |
| 229 | The Black Dog | **1** | 0 | 1 | WZBC 90.3 FM (`wzbc`): **1** (0 exact / 1 artist) |
| 230 | THE CURE | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 231 | The Donnas | **1** | 1 | 0 | WMFO 91.5 FM (`wmfo`): **1** (1 exact / 0 artist) |
| 232 | The Foundations | **1** | 0 | 1 | WESU 88.1 FM (`wesu`): **1** (0 exact / 1 artist) |
| 233 | The Glove | **1** | 0 | 1 | KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist) |
| 234 | The Growlers | **1** | 0 | 1 | WLUW 88.7 FM (`wluw`): **1** (0 exact / 1 artist) |
| 235 | The Lazy Eyes | **1** | 1 | 0 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (1 exact / 0 artist) |
| 236 | The Meters | **1** | 1 | 0 | KALX 90.7 FM (`kalx`): **1** (1 exact / 0 artist) |
| 237 | The Psychic Paramount | **1** | 0 | 1 | WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 238 | The Righteous Brothers | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 239 | The Sisters of Mercy | **1** | 0 | 1 | KUCR 88.3 FM (`kucr`): **1** (0 exact / 1 artist) |
| 240 | THE SMITHS | **1** | 0 | 1 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist) |
| 241 | The Temptations | **1** | 1 | 0 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (1 exact / 0 artist) |
| 242 | The Voidz | **1** | 1 | 0 | WLUW 88.7 FM (`wluw`): **1** (1 exact / 0 artist) |
| 243 | This Will Destroy You | **1** | 0 | 1 | KALX 90.7 FM (`kalx`): **1** (0 exact / 1 artist) |
| 244 | Thundercat | **1** | 0 | 1 | KSJS 90.5 FM (`ksjs`): **1** (0 exact / 1 artist) |
| 245 | Toadies | **1** | 0 | 1 | WUOG 90.5 FM (`wuog`): **1** (0 exact / 1 artist) |
| 246 | Tommy Guerrero | **1** | 0 | 1 | KXLU 88.9 FM (`kxlu`): **1** (0 exact / 1 artist) |
| 247 | Tortoise | **1** | 1 | 0 | KDVS 90.3 FM (`kdvs`): **1** (1 exact / 0 artist) |
| 248 | Underworld | **1** | 0 | 1 | KSJS 90.5 FM (`ksjs`): **1** (0 exact / 1 artist) |
| 249 | Vulfpeck | **1** | 1 | 0 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (1 exact / 0 artist) |
| 250 | Wallflowers | **1** | 0 | 1 | WTMD 89.7 Towson University, MD (`wtmd-89-7-towson-university-md`): **1** (0 exact / 1 artist) |
| 251 | White Noise | **1** | 0 | 1 | WPRB 103.3 FM (`wprb`): **1** (0 exact / 1 artist) |
| 252 | William Bell | **1** | 0 | 1 | KDVS 90.3 FM (`kdvs`): **1** (0 exact / 1 artist) |
| 253 | Woods | **1** | 0 | 1 | KVSC 88.1 FM (`kvsc`): **1** (0 exact / 1 artist) |
| 254 | Zach Hill | **1** | 1 | 0 | WHRB 95.3 FM (`whrb`): **1** (1 exact / 0 artist) |

## Specialist

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | Depeche Mode | **328** | 13 | 315 | KEXP 90.3 FM (`kexp`): **187** (4 exact / 183 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **22** (2 exact / 20 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **21** (0 exact / 21 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **20** (0 exact / 20 artist)<br>New Wave Radio (`new-wave-radio`): **18** (1 exact / 17 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **15** (1 exact / 14 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **14** (2 exact / 12 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **11** (1 exact / 10 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **10** (1 exact / 9 artist)<br>FIP Rock (`fip-rock`): **3** (0 exact / 3 artist)<br>FIP Electro (`fip-electro`): **2** (0 exact / 2 artist)<br>Gen X Radio (`gen-x-radio`): **2** (1 exact / 1 artist)<br>80s Forever - We Keep The 80s Alive (`80s-forever-we-keep-the-80s-alive`): **1** (0 exact / 1 artist)<br>All Oldies Channel (`all-oldies-channel`): **1** (0 exact / 1 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist) |
| 2 | David Bowie | **303** | 26 | 277 | KEXP 90.3 FM (`kexp`): **219** (22 exact / 197 artist)<br>New Wave Radio (`new-wave-radio`): **14** (1 exact / 13 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **13** (0 exact / 13 artist)<br>FIP Rock (`fip-rock`): **10** (1 exact / 9 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **8** (1 exact / 7 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **7** (1 exact / 6 artist)<br>All Oldies Channel (`all-oldies-channel`): **7** (0 exact / 7 artist)<br>Gen X Radio (`gen-x-radio`): **7** (0 exact / 7 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **6** (0 exact / 6 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **6** (0 exact / 6 artist)<br>80s Alive (`80s-alive`): **1** (0 exact / 1 artist)<br>80s Forever - We Keep The 80s Alive (`80s-forever-we-keep-the-80s-alive`): **1** (0 exact / 1 artist)<br>FIP Electro (`fip-electro`): **1** (0 exact / 1 artist)<br>FIP Groove (`fip-groove`): **1** (0 exact / 1 artist)<br>FIP Reggae (`fip-reggae`): **1** (0 exact / 1 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist) |
| 3 | The Beatles | **303** | 33 | 270 | KEXP 90.3 FM (`kexp`): **270** (33 exact / 237 artist)<br>24-7 Psychedelic Rock (`24-7-psychedelic-rock`): **10** (0 exact / 10 artist)<br>Gen X Radio (`gen-x-radio`): **10** (0 exact / 10 artist)<br>FIP Rock (`fip-rock`): **7** (0 exact / 7 artist)<br>All Oldies Channel (`all-oldies-channel`): **6** (0 exact / 6 artist) |
| 4 | The Cure | **296** | 2 | 294 | KEXP 90.3 FM (`kexp`): **234** (2 exact / 232 artist)<br>New Wave Radio (`new-wave-radio`): **20** (0 exact / 20 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **11** (0 exact / 11 artist)<br>FIP Rock (`fip-rock`): **10** (0 exact / 10 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **5** (0 exact / 5 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **5** (0 exact / 5 artist)<br>Gen X Radio (`gen-x-radio`): **3** (0 exact / 3 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **2** (0 exact / 2 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **2** (0 exact / 2 artist)<br>80s Alive (`80s-alive`): **1** (0 exact / 1 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **1** (0 exact / 1 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **1** (0 exact / 1 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **1** (0 exact / 1 artist) |
| 5 | Prince | **261** | 4 | 257 | KEXP 90.3 FM (`kexp`): **230** (1 exact / 229 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **10** (0 exact / 10 artist)<br>FIP Groove (`fip-groove`): **5** (1 exact / 4 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **4** (1 exact / 3 artist)<br>All Oldies Channel (`all-oldies-channel`): **3** (1 exact / 2 artist)<br>Gen X Radio (`gen-x-radio`): **3** (0 exact / 3 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **2** (0 exact / 2 artist)<br>80s Alive (`80s-alive`): **1** (0 exact / 1 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **1** (0 exact / 1 artist)<br>Worldwide FM (`worldwide-fm`): **1** (0 exact / 1 artist) |
| 6 | Talking Heads | **202** | 0 | 202 | KEXP 90.3 FM (`kexp`): **129** (0 exact / 129 artist)<br>New Wave Radio (`new-wave-radio`): **14** (0 exact / 14 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **10** (0 exact / 10 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **8** (0 exact / 8 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **8** (0 exact / 8 artist)<br>FIP Rock (`fip-rock`): **7** (0 exact / 7 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **7** (0 exact / 7 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **6** (0 exact / 6 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **3** (0 exact / 3 artist)<br>80s Alive (`80s-alive`): **2** (0 exact / 2 artist)<br>All Oldies Channel (`all-oldies-channel`): **2** (0 exact / 2 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **2** (0 exact / 2 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **2** (0 exact / 2 artist)<br>FIP Groove (`fip-groove`): **1** (0 exact / 1 artist)<br>Gen X Radio (`gen-x-radio`): **1** (0 exact / 1 artist) |
| 7 | Grateful Dead | **194** | 1 | 193 | KEXP 90.3 FM (`kexp`): **147** (1 exact / 146 artist)<br>Radio Caprice - Psychedelic Folk (`radio-caprice-psychedelic-folk`): **44** (0 exact / 44 artist)<br>FIP Rock (`fip-rock`): **3** (0 exact / 3 artist) |
| 8 | Duran Duran | **189** | 0 | 189 | KEXP 90.3 FM (`kexp`): **69** (0 exact / 69 artist)<br>New Wave Radio (`new-wave-radio`): **18** (0 exact / 18 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **16** (0 exact / 16 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **15** (0 exact / 15 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **14** (0 exact / 14 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **14** (0 exact / 14 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **13** (0 exact / 13 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **7** (0 exact / 7 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **7** (0 exact / 7 artist)<br>Gen X Radio (`gen-x-radio`): **6** (0 exact / 6 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **6** (0 exact / 6 artist)<br>All Oldies Channel (`all-oldies-channel`): **4** (0 exact / 4 artist) |
| 9 | Nina Simone | **187** | 1 | 186 | KEXP 90.3 FM (`kexp`): **174** (1 exact / 173 artist)<br>FIP Jazz (`fip-jazz`): **5** (0 exact / 5 artist)<br>Suite Jazz Radio (`suite-jazz-radio`): **5** (0 exact / 5 artist)<br>All Oldies Channel (`all-oldies-channel`): **1** (0 exact / 1 artist)<br>FIP Groove (`fip-groove`): **1** (0 exact / 1 artist)<br>Gen X Radio (`gen-x-radio`): **1** (0 exact / 1 artist) |
| 10 | Marvin Gaye | **184** | 1 | 183 | KEXP 90.3 FM (`kexp`): **161** (1 exact / 160 artist)<br>FIP Groove (`fip-groove`): **8** (0 exact / 8 artist)<br>All Oldies Channel (`all-oldies-channel`): **7** (0 exact / 7 artist)<br>Gen X Radio (`gen-x-radio`): **5** (0 exact / 5 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **2** (0 exact / 2 artist)<br>80s Alive (`80s-alive`): **1** (0 exact / 1 artist) |
| 11 | R.E.M. | **166** | 0 | 166 | KEXP 90.3 FM (`kexp`): **131** (0 exact / 131 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **9** (0 exact / 9 artist)<br>New Wave Radio (`new-wave-radio`): **9** (0 exact / 9 artist)<br>FIP Rock (`fip-rock`): **5** (0 exact / 5 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **3** (0 exact / 3 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **2** (0 exact / 2 artist)<br>Gen X Radio (`gen-x-radio`): **2** (0 exact / 2 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **2** (0 exact / 2 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **2** (0 exact / 2 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist) |
| 12 | Nirvana | **162** | 0 | 162 | KEXP 90.3 FM (`kexp`): **153** (0 exact / 153 artist)<br>FIP Rock (`fip-rock`): **8** (0 exact / 8 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist) |
| 13 | Kraftwerk | **159** | 0 | 159 | KEXP 90.3 FM (`kexp`): **107** (0 exact / 107 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **10** (0 exact / 10 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **10** (0 exact / 10 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **8** (0 exact / 8 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **6** (0 exact / 6 artist)<br>FIP Electro (`fip-electro`): **5** (0 exact / 5 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **3** (0 exact / 3 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **3** (0 exact / 3 artist)<br>80s Forever - We Keep The 80s Alive (`80s-forever-we-keep-the-80s-alive`): **2** (0 exact / 2 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist)<br>Gen X Radio (`gen-x-radio`): **1** (0 exact / 1 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (0 exact / 1 artist)<br>New Wave Radio (`new-wave-radio`): **1** (0 exact / 1 artist) |
| 14 | Bob Marley & The Wailers | **148** | 5 | 143 | KEXP 90.3 FM (`kexp`): **142** (5 exact / 137 artist)<br>FIP Reggae (`fip-reggae`): **6** (0 exact / 6 artist) |
| 15 | Dolly Parton | **132** | 3 | 129 | KEXP 90.3 FM (`kexp`): **128** (1 exact / 127 artist)<br>All Oldies Channel (`all-oldies-channel`): **2** (1 exact / 1 artist)<br>Gen X Radio (`gen-x-radio`): **2** (1 exact / 1 artist) |
| 16 | Kate Bush | **128** | 15 | 113 | KEXP 90.3 FM (`kexp`): **90** (3 exact / 87 artist)<br>Gen X Radio (`gen-x-radio`): **7** (1 exact / 6 artist)<br>All Oldies Channel (`all-oldies-channel`): **5** (1 exact / 4 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **5** (2 exact / 3 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **3** (1 exact / 2 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **3** (2 exact / 1 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **3** (2 exact / 1 artist)<br>SomaFM — Lush (`somafm-lush`): **3** (0 exact / 3 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **2** (1 exact / 1 artist)<br>New Wave Radio (`new-wave-radio`): **2** (2 exact / 0 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **1** (0 exact / 1 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist)<br>FIP World (`fip-world`): **1** (0 exact / 1 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (0 exact / 1 artist) |
| 17 | Pink Floyd | **126** | 12 | 114 | KEXP 90.3 FM (`kexp`): **97** (10 exact / 87 artist)<br>24-7 Psychedelic Rock (`24-7-psychedelic-rock`): **18** (0 exact / 18 artist)<br>FIP Rock (`fip-rock`): **9** (2 exact / 7 artist)<br>Gen X Radio (`gen-x-radio`): **2** (0 exact / 2 artist) |
| 18 | Eurythmics | **112** | 0 | 112 | KEXP 90.3 FM (`kexp`): **34** (0 exact / 34 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **15** (0 exact / 15 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **13** (0 exact / 13 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **11** (0 exact / 11 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **9** (0 exact / 9 artist)<br>New Wave Radio (`new-wave-radio`): **7** (0 exact / 7 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **6** (0 exact / 6 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **5** (0 exact / 5 artist)<br>All Oldies Channel (`all-oldies-channel`): **3** (0 exact / 3 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **3** (0 exact / 3 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **3** (0 exact / 3 artist)<br>80s Alive (`80s-alive`): **1** (0 exact / 1 artist)<br>FIP Electro (`fip-electro`): **1** (0 exact / 1 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 19 | Jimi Hendrix | **111** | 0 | 111 | KEXP 90.3 FM (`kexp`): **87** (0 exact / 87 artist)<br>FIP Rock (`fip-rock`): **10** (0 exact / 10 artist)<br>24-7 Psychedelic Rock (`24-7-psychedelic-rock`): **8** (0 exact / 8 artist)<br>All Oldies Channel (`all-oldies-channel`): **5** (0 exact / 5 artist)<br>FIP Groove (`fip-groove`): **1** (0 exact / 1 artist) |
| 20 | Björk | **107** | 0 | 107 | KEXP 90.3 FM (`kexp`): **100** (0 exact / 100 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **2** (0 exact / 2 artist)<br>FIP Electro (`fip-electro`): **2** (0 exact / 2 artist)<br>SomaFM — Lush (`somafm-lush`): **2** (0 exact / 2 artist)<br>FIP Jazz (`fip-jazz`): **1** (0 exact / 1 artist) |
| 21 | The Cars | **99** | 4 | 95 | KEXP 90.3 FM (`kexp`): **42** (0 exact / 42 artist)<br>New Wave Radio (`new-wave-radio`): **19** (2 exact / 17 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **12** (1 exact / 11 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **10** (1 exact / 9 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **5** (0 exact / 5 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **4** (0 exact / 4 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **4** (0 exact / 4 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **2** (0 exact / 2 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 22 | Fleetwood Mac | **97** | 0 | 97 | KEXP 90.3 FM (`kexp`): **76** (0 exact / 76 artist)<br>FIP Rock (`fip-rock`): **7** (0 exact / 7 artist)<br>All Oldies Channel (`all-oldies-channel`): **6** (0 exact / 6 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **6** (0 exact / 6 artist)<br>80s Alive (`80s-alive`): **1** (0 exact / 1 artist)<br>Gen X Radio (`gen-x-radio`): **1** (0 exact / 1 artist) |
| 23 | Underworld | **96** | 0 | 96 | KEXP 90.3 FM (`kexp`): **80** (0 exact / 80 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **4** (0 exact / 4 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **4** (0 exact / 4 artist)<br>FIP Electro (`fip-electro`): **3** (0 exact / 3 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **2** (0 exact / 2 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist)<br>New Wave Radio (`new-wave-radio`): **1** (0 exact / 1 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **1** (0 exact / 1 artist) |
| 24 | King Gizzard & The Lizard Wizard | **95** | 1 | 94 | KEXP 90.3 FM (`kexp`): **94** (1 exact / 93 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 25 | Neil Young | **95** | 0 | 95 | KEXP 90.3 FM (`kexp`): **88** (0 exact / 88 artist)<br>FIP Rock (`fip-rock`): **5** (0 exact / 5 artist)<br>80s Forever - We Keep The 80s Alive (`80s-forever-we-keep-the-80s-alive`): **1** (0 exact / 1 artist)<br>All Oldies Channel (`all-oldies-channel`): **1** (0 exact / 1 artist) |
| 26 | Peter Gabriel | **92** | 2 | 90 | KEXP 90.3 FM (`kexp`): **53** (2 exact / 51 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **8** (0 exact / 8 artist)<br>New Wave Radio (`new-wave-radio`): **8** (0 exact / 8 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **6** (0 exact / 6 artist)<br>FIP Rock (`fip-rock`): **5** (0 exact / 5 artist)<br>Gen X Radio (`gen-x-radio`): **4** (0 exact / 4 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **2** (0 exact / 2 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **2** (0 exact / 2 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **2** (0 exact / 2 artist)<br>All Oldies Channel (`all-oldies-channel`): **1** (0 exact / 1 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (0 exact / 1 artist) |
| 27 | The Beach Boys | **92** | 0 | 92 | KEXP 90.3 FM (`kexp`): **85** (0 exact / 85 artist)<br>Gen X Radio (`gen-x-radio`): **4** (0 exact / 4 artist)<br>FIP Rock (`fip-rock`): **2** (0 exact / 2 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist) |
| 28 | Nine Inch Nails | **89** | 1 | 88 | KEXP 90.3 FM (`kexp`): **83** (1 exact / 82 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **4** (0 exact / 4 artist)<br>FIP Rock (`fip-rock`): **2** (0 exact / 2 artist) |
| 29 | Black Sabbath | **87** | 7 | 80 | KEXP 90.3 FM (`kexp`): **86** (7 exact / 79 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 30 | The Replacements | **85** | 0 | 85 | KEXP 90.3 FM (`kexp`): **79** (0 exact / 79 artist)<br>New Wave Radio (`new-wave-radio`): **4** (0 exact / 4 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **1** (0 exact / 1 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **1** (0 exact / 1 artist) |
| 31 | The Smiths | **84** | 29 | 55 | KEXP 90.3 FM (`kexp`): **50** (29 exact / 21 artist)<br>FIP Rock (`fip-rock`): **9** (0 exact / 9 artist)<br>New Wave Radio (`new-wave-radio`): **7** (0 exact / 7 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **6** (0 exact / 6 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **5** (0 exact / 5 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **5** (0 exact / 5 artist)<br>80s Alive (`80s-alive`): **1** (0 exact / 1 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (0 exact / 1 artist) |
| 32 | Low | **79** | 0 | 79 | KEXP 90.3 FM (`kexp`): **79** (0 exact / 79 artist) |
| 33 | Modest Mouse | **79** | 2 | 77 | KEXP 90.3 FM (`kexp`): **78** (2 exact / 76 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 34 | Thievery Corporation | **78** | 1 | 77 | KEXP 90.3 FM (`kexp`): **52** (1 exact / 51 artist)<br>FIP Reggae (`fip-reggae`): **8** (0 exact / 8 artist)<br>SomaFM — Lush (`somafm-lush`): **6** (0 exact / 6 artist)<br>SomaFM — Suburbs of Goa (`somafm-suburbsofgoa`): **5** (0 exact / 5 artist)<br>SomaFM Suburbs of Goa (128k AAC) (`somafm-suburbs-of-goa-128k-aac`): **3** (0 exact / 3 artist)<br>FIP Electro (`fip-electro`): **1** (0 exact / 1 artist)<br>FIP Groove (`fip-groove`): **1** (0 exact / 1 artist)<br>FIP World (`fip-world`): **1** (0 exact / 1 artist)<br>PsyRadio Chillout (`psyradio-chillout`): **1** (0 exact / 1 artist) |
| 35 | Khruangbin | **77** | 6 | 71 | KEXP 90.3 FM (`kexp`): **75** (6 exact / 69 artist)<br>FIP Reggae (`fip-reggae`): **2** (0 exact / 2 artist) |
| 36 | The The | **76** | 7 | 69 | KEXP 90.3 FM (`kexp`): **45** (1 exact / 44 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **6** (1 exact / 5 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **5** (1 exact / 4 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **5** (1 exact / 4 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **5** (1 exact / 4 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **5** (1 exact / 4 artist)<br>New Wave Radio (`new-wave-radio`): **3** (1 exact / 2 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (0 exact / 1 artist) |
| 37 | Queen | **75** | 0 | 75 | KEXP 90.3 FM (`kexp`): **52** (0 exact / 52 artist)<br>All Oldies Channel (`all-oldies-channel`): **10** (0 exact / 10 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **4** (0 exact / 4 artist)<br>Gen X Radio (`gen-x-radio`): **3** (0 exact / 3 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **3** (0 exact / 3 artist)<br>80s Alive (`80s-alive`): **2** (0 exact / 2 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 38 | Gorillaz | **72** | 0 | 72 | KEXP 90.3 FM (`kexp`): **70** (0 exact / 70 artist)<br>FIP Electro (`fip-electro`): **1** (0 exact / 1 artist)<br>FIP Reggae (`fip-reggae`): **1** (0 exact / 1 artist) |
| 39 | Tears for Fears | **71** | 0 | 71 | KEXP 90.3 FM (`kexp`): **53** (0 exact / 53 artist)<br>New Wave Radio (`new-wave-radio`): **4** (0 exact / 4 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **3** (0 exact / 3 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **2** (0 exact / 2 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **2** (0 exact / 2 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **2** (0 exact / 2 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **2** (0 exact / 2 artist)<br>80s Alive (`80s-alive`): **1** (0 exact / 1 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **1** (0 exact / 1 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **1** (0 exact / 1 artist) |
| 40 | Tears For Fears | **69** | 6 | 63 | New Wave Radio (`new-wave-radio`): **12** (0 exact / 12 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **8** (0 exact / 8 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **8** (0 exact / 8 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **8** (0 exact / 8 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **6** (1 exact / 5 artist)<br>KEXP 90.3 FM (`kexp`): **6** (0 exact / 6 artist)<br>Gen X Radio (`gen-x-radio`): **5** (1 exact / 4 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **5** (1 exact / 4 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **4** (1 exact / 3 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **4** (1 exact / 3 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **2** (0 exact / 2 artist)<br>All Oldies Channel (`all-oldies-channel`): **1** (1 exact / 0 artist) |
| 41 | Billy Idol | **63** | 0 | 63 | KEXP 90.3 FM (`kexp`): **19** (0 exact / 19 artist)<br>New Wave Radio (`new-wave-radio`): **11** (0 exact / 11 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **9** (0 exact / 9 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **5** (0 exact / 5 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **5** (0 exact / 5 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **4** (0 exact / 4 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **3** (0 exact / 3 artist)<br>All Oldies Channel (`all-oldies-channel`): **2** (0 exact / 2 artist)<br>FIP Rock (`fip-rock`): **2** (0 exact / 2 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **1** (0 exact / 1 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **1** (0 exact / 1 artist)<br>Gen X Radio (`gen-x-radio`): **1** (0 exact / 1 artist) |
| 42 | T. Rex | **59** | 6 | 53 | KEXP 90.3 FM (`kexp`): **55** (6 exact / 49 artist)<br>FIP Rock (`fip-rock`): **2** (0 exact / 2 artist)<br>Gen X Radio (`gen-x-radio`): **2** (0 exact / 2 artist) |
| 43 | Sigur Rós | **55** | 0 | 55 | KEXP 90.3 FM (`kexp`): **50** (0 exact / 50 artist)<br>FIP Rock (`fip-rock`): **5** (0 exact / 5 artist) |
| 44 | Fela Kuti | **51** | 0 | 51 | KEXP 90.3 FM (`kexp`): **48** (0 exact / 48 artist)<br>FIP World (`fip-world`): **2** (0 exact / 2 artist)<br>FIP Reggae (`fip-reggae`): **1** (0 exact / 1 artist) |
| 45 | Ween | **51** | 0 | 51 | KEXP 90.3 FM (`kexp`): **51** (0 exact / 51 artist) |
| 46 | Chelsea Wolfe | **50** | 0 | 50 | KEXP 90.3 FM (`kexp`): **27** (0 exact / 27 artist)<br>SomaFM Folk Forward (128k AAC) (`somafm-folk-forward-128k-aac`): **12** (0 exact / 12 artist)<br>SomaFM Folk Forward (128k MP3) (`somafm-folk-forward-128k-mp3`): **11** (0 exact / 11 artist) |
| 47 | King Gizzard & the Lizard Wizard | **49** | 3 | 46 | KEXP 90.3 FM (`kexp`): **49** (3 exact / 46 artist) |
| 48 | Bauhaus | **48** | 0 | 48 | KEXP 90.3 FM (`kexp`): **38** (0 exact / 38 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **5** (0 exact / 5 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **2** (0 exact / 2 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **2** (0 exact / 2 artist)<br>New Wave Radio (`new-wave-radio`): **1** (0 exact / 1 artist) |
| 49 | Judas Priest | **48** | 0 | 48 | KEXP 90.3 FM (`kexp`): **46** (0 exact / 46 artist)<br>All Oldies Channel (`all-oldies-channel`): **1** (0 exact / 1 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 50 | Chaka Khan | **47** | 0 | 47 | KEXP 90.3 FM (`kexp`): **42** (0 exact / 42 artist)<br>All Oldies Channel (`all-oldies-channel`): **2** (0 exact / 2 artist)<br>FIP Groove (`fip-groove`): **2** (0 exact / 2 artist)<br>Suite Jazz Radio (`suite-jazz-radio`): **1** (0 exact / 1 artist) |
| 51 | The Brian Jonestown Massacre | **47** | 0 | 47 | KEXP 90.3 FM (`kexp`): **44** (0 exact / 44 artist)<br>FIP Rock (`fip-rock`): **3** (0 exact / 3 artist) |
| 52 | La Luz | **45** | 2 | 43 | KEXP 90.3 FM (`kexp`): **45** (2 exact / 43 artist) |
| 53 | Future Islands | **44** | 1 | 43 | KEXP 90.3 FM (`kexp`): **44** (1 exact / 43 artist) |
| 54 | Missing Persons | **43** | 7 | 36 | KEXP 90.3 FM (`kexp`): **11** (1 exact / 10 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **8** (1 exact / 7 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **7** (1 exact / 6 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **6** (1 exact / 5 artist)<br>New Wave Radio (`new-wave-radio`): **5** (1 exact / 4 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **4** (1 exact / 3 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **2** (1 exact / 1 artist) |
| 55 | The Black Angels | **42** | 1 | 41 | KEXP 90.3 FM (`kexp`): **40** (1 exact / 39 artist)<br>FIP Rock (`fip-rock`): **2** (0 exact / 2 artist) |
| 56 | Ozzy Osbourne | **40** | 0 | 40 | KEXP 90.3 FM (`kexp`): **40** (0 exact / 40 artist) |
| 57 | Dengue Fever | **39** | 4 | 35 | KEXP 90.3 FM (`kexp`): **38** (4 exact / 34 artist)<br>FIP World (`fip-world`): **1** (0 exact / 1 artist) |
| 58 | Juana Molina | **37** | 0 | 37 | KEXP 90.3 FM (`kexp`): **35** (0 exact / 35 artist)<br>FIP Electro (`fip-electro`): **1** (0 exact / 1 artist)<br>FIP World (`fip-world`): **1** (0 exact / 1 artist) |
| 59 | The Smashing Pumpkins | **37** | 0 | 37 | KEXP 90.3 FM (`kexp`): **35** (0 exact / 35 artist)<br>FIP Rock (`fip-rock`): **2** (0 exact / 2 artist) |
| 60 | Chinese American Bear | **36** | 1 | 35 | KEXP 90.3 FM (`kexp`): **36** (1 exact / 35 artist) |
| 61 | David Byrne | **36** | 3 | 33 | KEXP 90.3 FM (`kexp`): **33** (2 exact / 31 artist)<br>FIP Rock (`fip-rock`): **2** (1 exact / 1 artist)<br>FIP Groove (`fip-groove`): **1** (0 exact / 1 artist) |
| 62 | Heart | **36** | 5 | 31 | KEXP 90.3 FM (`kexp`): **30** (1 exact / 29 artist)<br>Gen X Radio (`gen-x-radio`): **3** (2 exact / 1 artist)<br>All Oldies Channel (`all-oldies-channel`): **2** (1 exact / 1 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (1 exact / 0 artist) |
| 63 | MGMT | **36** | 2 | 34 | KEXP 90.3 FM (`kexp`): **34** (1 exact / 33 artist)<br>FIP Rock (`fip-rock`): **2** (1 exact / 1 artist) |
| 64 | Paul McCartney | **36** | 0 | 36 | KEXP 90.3 FM (`kexp`): **30** (0 exact / 30 artist)<br>All Oldies Channel (`all-oldies-channel`): **2** (0 exact / 2 artist)<br>Gen X Radio (`gen-x-radio`): **2** (0 exact / 2 artist)<br>80s Alive (`80s-alive`): **1** (0 exact / 1 artist)<br>FIP Groove (`fip-groove`): **1** (0 exact / 1 artist) |
| 65 | ROSALÍA | **35** | 1 | 34 | KEXP 90.3 FM (`kexp`): **34** (1 exact / 33 artist)<br>FIP Electro (`fip-electro`): **1** (0 exact / 1 artist) |
| 66 | Oneohtrix Point Never | **34** | 1 | 33 | KEXP 90.3 FM (`kexp`): **30** (1 exact / 29 artist)<br>RADCAP: DRONE AMBIENT (`radcap-drone-ambient`): **4** (0 exact / 4 artist) |
| 67 | Foo Fighters | **33** | 0 | 33 | KEXP 90.3 FM (`kexp`): **31** (0 exact / 31 artist)<br>FIP Rock (`fip-rock`): **2** (0 exact / 2 artist) |
| 68 | Kikagaku Moyo | **33** | 1 | 32 | KEXP 90.3 FM (`kexp`): **31** (1 exact / 30 artist)<br>FIP Electro (`fip-electro`): **1** (0 exact / 1 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 69 | Genesis | **32** | 0 | 32 | KEXP 90.3 FM (`kexp`): **22** (0 exact / 22 artist)<br>FIP Rock (`fip-rock`): **4** (0 exact / 4 artist)<br>All Oldies Channel (`all-oldies-channel`): **3** (0 exact / 3 artist)<br>Gen X Radio (`gen-x-radio`): **2** (0 exact / 2 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist) |
| 70 | Panda Bear | **32** | 4 | 28 | KEXP 90.3 FM (`kexp`): **32** (4 exact / 28 artist) |
| 71 | Bronski Beat | **31** | 7 | 24 | KEXP 90.3 FM (`kexp`): **7** (0 exact / 7 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **5** (1 exact / 4 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **5** (1 exact / 4 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **5** (1 exact / 4 artist)<br>New Wave Radio (`new-wave-radio`): **3** (0 exact / 3 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **2** (1 exact / 1 artist)<br>FIP Electro (`fip-electro`): **1** (1 exact / 0 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **1** (1 exact / 0 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **1** (1 exact / 0 artist)<br>Gen X Radio (`gen-x-radio`): **1** (0 exact / 1 artist) |
| 72 | Daryl Hall & John Oates | **31** | 0 | 31 | KEXP 90.3 FM (`kexp`): **27** (0 exact / 27 artist)<br>Gen X Radio (`gen-x-radio`): **2** (0 exact / 2 artist)<br>80s Alive (`80s-alive`): **1** (0 exact / 1 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **1** (0 exact / 1 artist) |
| 73 | ODESZA | **31** | 4 | 27 | KEXP 90.3 FM (`kexp`): **31** (4 exact / 27 artist) |
| 74 | Floating Points | **30** | 0 | 30 | KEXP 90.3 FM (`kexp`): **27** (0 exact / 27 artist)<br>FIP Electro (`fip-electro`): **3** (0 exact / 3 artist) |
| 75 | All Them Witches | **29** | 1 | 28 | KEXP 90.3 FM (`kexp`): **28** (1 exact / 27 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 76 | Beach Fossils | **28** | 0 | 28 | KEXP 90.3 FM (`kexp`): **26** (0 exact / 26 artist)<br>FIP Rock (`fip-rock`): **2** (0 exact / 2 artist) |
| 77 | Castle Rat | **28** | 3 | 25 | SomaFM Metal Detector (128k MP3) (`somafm-metal-detector-128k-mp3`): **10** (1 exact / 9 artist)<br>KEXP 90.3 FM (`kexp`): **9** (1 exact / 8 artist)<br>SomaFM Metal Detector (128k AAC) (`somafm-metal-detector-128k-aac`): **9** (1 exact / 8 artist) |
| 78 | The Band | **28** | 3 | 25 | KEXP 90.3 FM (`kexp`): **27** (3 exact / 24 artist)<br>Radio Caprice - Psychedelic Folk (`radio-caprice-psychedelic-folk`): **1** (0 exact / 1 artist) |
| 79 | Turnstile | **28** | 1 | 27 | KEXP 90.3 FM (`kexp`): **28** (1 exact / 27 artist) |
| 80 | Billy Joel | **27** | 0 | 27 | KEXP 90.3 FM (`kexp`): **20** (0 exact / 20 artist)<br>Gen X Radio (`gen-x-radio`): **5** (0 exact / 5 artist)<br>All Oldies Channel (`all-oldies-channel`): **1** (0 exact / 1 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist) |
| 81 | Deerhoof | **27** | 7 | 20 | KEXP 90.3 FM (`kexp`): **27** (7 exact / 20 artist) |
| 82 | Hole | **27** | 1 | 26 | KEXP 90.3 FM (`kexp`): **24** (0 exact / 24 artist)<br>FIP Rock (`fip-rock`): **3** (1 exact / 2 artist) |
| 83 | Woods | **27** | 0 | 27 | KEXP 90.3 FM (`kexp`): **17** (0 exact / 17 artist)<br>FIP Rock (`fip-rock`): **6** (0 exact / 6 artist)<br>Radio Caprice - Psychedelic Folk (`radio-caprice-psychedelic-folk`): **3** (0 exact / 3 artist)<br>FIP Groove (`fip-groove`): **1** (0 exact / 1 artist) |
| 84 | Momma | **26** | 0 | 26 | KEXP 90.3 FM (`kexp`): **26** (0 exact / 26 artist) |
| 85 | The Cranberries | **26** | 0 | 26 | KEXP 90.3 FM (`kexp`): **24** (0 exact / 24 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist)<br>Gen X Radio (`gen-x-radio`): **1** (0 exact / 1 artist) |
| 86 | Beatles | **25** | 0 | 25 | 24-7 Psychedelic Rock (`24-7-psychedelic-rock`): **20** (0 exact / 20 artist)<br>KEXP 90.3 FM (`kexp`): **3** (0 exact / 3 artist)<br>All Oldies Channel (`all-oldies-channel`): **2** (0 exact / 2 artist) |
| 87 | Dead Meadow | **25** | 1 | 24 | KEXP 90.3 FM (`kexp`): **25** (1 exact / 24 artist) |
| 88 | MJ Lenderman | **25** | 0 | 25 | KEXP 90.3 FM (`kexp`): **24** (0 exact / 24 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 89 | Psychedelic Porn Crumpets | **25** | 0 | 25 | KEXP 90.3 FM (`kexp`): **25** (0 exact / 25 artist) |
| 90 | Steely Dan | **25** | 24 | 1 | KEXP 90.3 FM (`kexp`): **17** (17 exact / 0 artist)<br>FIP Rock (`fip-rock`): **4** (4 exact / 0 artist)<br>Gen X Radio (`gen-x-radio`): **4** (3 exact / 1 artist) |
| 91 | Deftones | **24** | 1 | 23 | KEXP 90.3 FM (`kexp`): **24** (1 exact / 23 artist) |
| 92 | Red Hot Chili Peppers | **23** | 0 | 23 | KEXP 90.3 FM (`kexp`): **15** (0 exact / 15 artist)<br>FIP Rock (`fip-rock`): **7** (0 exact / 7 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist) |
| 93 | Rush | **23** | 0 | 23 | KEXP 90.3 FM (`kexp`): **21** (0 exact / 21 artist)<br>80s Alive (`80s-alive`): **1** (0 exact / 1 artist)<br>All Oldies Channel (`all-oldies-channel`): **1** (0 exact / 1 artist) |
| 94 | The Murlocs | **23** | 3 | 20 | KEXP 90.3 FM (`kexp`): **23** (3 exact / 20 artist) |
| 95 | Tony Allen | **23** | 0 | 23 | KEXP 90.3 FM (`kexp`): **16** (0 exact / 16 artist)<br>FIP World (`fip-world`): **5** (0 exact / 5 artist)<br>FIP Electro (`fip-electro`): **1** (0 exact / 1 artist)<br>FIP Jazz (`fip-jazz`): **1** (0 exact / 1 artist) |
| 96 | Protomartyr | **22** | 0 | 22 | KEXP 90.3 FM (`kexp`): **22** (0 exact / 22 artist) |
| 97 | Soul Coughing | **22** | 0 | 22 | KEXP 90.3 FM (`kexp`): **21** (0 exact / 21 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 98 | Bananarama | **21** | 8 | 13 | Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **5** (1 exact / 4 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **4** (1 exact / 3 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **2** (1 exact / 1 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **2** (1 exact / 1 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **2** (0 exact / 2 artist)<br>New Wave Radio (`new-wave-radio`): **2** (1 exact / 1 artist)<br>All Oldies Channel (`all-oldies-channel`): **1** (0 exact / 1 artist)<br>KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **1** (1 exact / 0 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **1** (1 exact / 0 artist) |
| 99 | Black Moth Super Rainbow | **21** | 2 | 19 | KEXP 90.3 FM (`kexp`): **21** (2 exact / 19 artist) |
| 100 | Bombay Bicycle Club | **21** | 0 | 21 | KEXP 90.3 FM (`kexp`): **21** (0 exact / 21 artist) |
| 101 | Dungen | **21** | 5 | 16 | KEXP 90.3 FM (`kexp`): **20** (5 exact / 15 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 102 | Galaxie 500 | **21** | 1 | 20 | KEXP 90.3 FM (`kexp`): **21** (1 exact / 20 artist) |
| 103 | Holy Wave | **20** | 0 | 20 | KEXP 90.3 FM (`kexp`): **20** (0 exact / 20 artist) |
| 104 | Poliça | **20** | 4 | 16 | KEXP 90.3 FM (`kexp`): **16** (4 exact / 12 artist)<br>SomaFM — Lush (`somafm-lush`): **4** (0 exact / 4 artist) |
| 105 | Public Service Broadcasting | **20** | 0 | 20 | KEXP 90.3 FM (`kexp`): **19** (0 exact / 19 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 106 | The Sisters of Mercy | **20** | 0 | 20 | KEXP 90.3 FM (`kexp`): **18** (0 exact / 18 artist)<br>New Wave Radio (`new-wave-radio`): **2** (0 exact / 2 artist) |
| 107 | Tommy Guerrero | **20** | 0 | 20 | KEXP 90.3 FM (`kexp`): **18** (0 exact / 18 artist)<br>FIP Rock (`fip-rock`): **2** (0 exact / 2 artist) |
| 108 | Trentemøller | **20** | 0 | 20 | KEXP 90.3 FM (`kexp`): **19** (0 exact / 19 artist)<br>FIP Electro (`fip-electro`): **1** (0 exact / 1 artist) |
| 109 | HEALTH | **19** | 0 | 19 | KEXP 90.3 FM (`kexp`): **19** (0 exact / 19 artist) |
| 110 | Nancy Sinatra | **19** | 0 | 19 | KEXP 90.3 FM (`kexp`): **12** (0 exact / 12 artist)<br>FIP Rock (`fip-rock`): **4** (0 exact / 4 artist)<br>All Oldies Channel (`all-oldies-channel`): **1** (0 exact / 1 artist)<br>FIP Groove (`fip-groove`): **1** (0 exact / 1 artist)<br>FIP Jazz (`fip-jazz`): **1** (0 exact / 1 artist) |
| 111 | Smashing Pumpkins | **19** | 0 | 19 | KEXP 90.3 FM (`kexp`): **18** (0 exact / 18 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 112 | The True Loves | **19** | 1 | 18 | KEXP 90.3 FM (`kexp`): **19** (1 exact / 18 artist) |
| 113 | DOOM GONG | **18** | 0 | 18 | KEXP 90.3 FM (`kexp`): **18** (0 exact / 18 artist) |
| 114 | Mahalia Jackson | **18** | 1 | 17 | KEXP 90.3 FM (`kexp`): **18** (1 exact / 17 artist) |
| 115 | Pissed Jeans | **18** | 1 | 17 | KEXP 90.3 FM (`kexp`): **18** (1 exact / 17 artist) |
| 116 | Squid | **18** | 1 | 17 | KEXP 90.3 FM (`kexp`): **17** (1 exact / 16 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 117 | toe | **18** | 0 | 18 | KEXP 90.3 FM (`kexp`): **18** (0 exact / 18 artist) |
| 118 | TOKiMONSTA | **18** | 0 | 18 | KEXP 90.3 FM (`kexp`): **18** (0 exact / 18 artist) |
| 119 | Bone Thugs‐n‐Harmony | **17** | 0 | 17 | KEXP 90.3 FM (`kexp`): **16** (0 exact / 16 artist)<br>FIP Groove (`fip-groove`): **1** (0 exact / 1 artist) |
| 120 | Clark | **17** | 2 | 15 | KEXP 90.3 FM (`kexp`): **16** (2 exact / 14 artist)<br>FIP Electro (`fip-electro`): **1** (0 exact / 1 artist) |
| 121 | Kaitlyn Aurelia Smith | **17** | 0 | 17 | KEXP 90.3 FM (`kexp`): **15** (0 exact / 15 artist)<br>FIP Electro (`fip-electro`): **2** (0 exact / 2 artist) |
| 122 | Mk.gee | **17** | 2 | 15 | KEXP 90.3 FM (`kexp`): **17** (2 exact / 15 artist) |
| 123 | Phil Collins | **17** | 0 | 17 | KEXP 90.3 FM (`kexp`): **6** (0 exact / 6 artist)<br>Gen X Radio (`gen-x-radio`): **4** (0 exact / 4 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **4** (0 exact / 4 artist)<br>80s Alive (`80s-alive`): **3** (0 exact / 3 artist) |
| 124 | Tangerine Dream | **17** | 1 | 16 | KEXP 90.3 FM (`kexp`): **17** (1 exact / 16 artist) |
| 125 | The Blue Nile | **17** | 2 | 15 | KEXP 90.3 FM (`kexp`): **12** (1 exact / 11 artist)<br>New Wave Radio (`new-wave-radio`): **2** (1 exact / 1 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **2** (0 exact / 2 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **1** (0 exact / 1 artist) |
| 126 | William Bell | **17** | 0 | 17 | KEXP 90.3 FM (`kexp`): **17** (0 exact / 17 artist) |
| 127 | Elephant Stone | **16** | 1 | 15 | KEXP 90.3 FM (`kexp`): **15** (1 exact / 14 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 128 | Ghost | **16** | 0 | 16 | Radio Caprice - Psychedelic Folk (`radio-caprice-psychedelic-folk`): **11** (0 exact / 11 artist)<br>KEXP 90.3 FM (`kexp`): **5** (0 exact / 5 artist) |
| 129 | King Crimson | **16** | 0 | 16 | KEXP 90.3 FM (`kexp`): **15** (0 exact / 15 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 130 | The Clean | **16** | 0 | 16 | KEXP 90.3 FM (`kexp`): **15** (0 exact / 15 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 131 | Balmorhea | **15** | 0 | 15 | KEXP 90.3 FM (`kexp`): **8** (0 exact / 8 artist)<br>SomaFM Folk Forward (128k MP3) (`somafm-folk-forward-128k-mp3`): **4** (0 exact / 4 artist)<br>SomaFM Folk Forward (128k AAC) (`somafm-folk-forward-128k-aac`): **3** (0 exact / 3 artist) |
| 132 | Britney Spears | **15** | 0 | 15 | KEXP 90.3 FM (`kexp`): **11** (0 exact / 11 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **4** (0 exact / 4 artist) |
| 133 | Cars | **15** | 4 | 11 | New Wave - BestNet Radio (`new-wave-bestnet-radio`): **9** (1 exact / 8 artist)<br>KEXP 90.3 FM (`kexp`): **2** (1 exact / 1 artist)<br>80s Alive (`80s-alive`): **1** (0 exact / 1 artist)<br>All Oldies Channel (`all-oldies-channel`): **1** (0 exact / 1 artist)<br>FIP Rock (`fip-rock`): **1** (1 exact / 0 artist)<br>New Wave Radio (`new-wave-radio`): **1** (1 exact / 0 artist) |
| 134 | Cure | **15** | 0 | 15 | SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **5** (0 exact / 5 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **5** (0 exact / 5 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **3** (0 exact / 3 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **1** (0 exact / 1 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **1** (0 exact / 1 artist) |
| 135 | Dirty Projectors | **15** | 0 | 15 | KEXP 90.3 FM (`kexp`): **14** (0 exact / 14 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 136 | Iceage | **15** | 0 | 15 | KEXP 90.3 FM (`kexp`): **14** (0 exact / 14 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 137 | Lady Gaga | **15** | 0 | 15 | KEXP 90.3 FM (`kexp`): **15** (0 exact / 15 artist) |
| 138 | The Mars Volta | **15** | 0 | 15 | KEXP 90.3 FM (`kexp`): **15** (0 exact / 15 artist) |
| 139 | Chromeo | **14** | 0 | 14 | KEXP 90.3 FM (`kexp`): **14** (0 exact / 14 artist) |
| 140 | Gong | **14** | 0 | 14 | KEXP 90.3 FM (`kexp`): **11** (0 exact / 11 artist)<br>FIP Rock (`fip-rock`): **2** (0 exact / 2 artist)<br>FIP Jazz (`fip-jazz`): **1** (0 exact / 1 artist) |
| 141 | Jodeci | **14** | 0 | 14 | KEXP 90.3 FM (`kexp`): **14** (0 exact / 14 artist) |
| 142 | Maxwell | **14** | 0 | 14 | KEXP 90.3 FM (`kexp`): **14** (0 exact / 14 artist) |
| 143 | Wine Lips | **14** | 2 | 12 | KEXP 90.3 FM (`kexp`): **14** (2 exact / 12 artist) |
| 144 | Crosby, Stills, Nash & Young | **13** | 0 | 13 | KEXP 90.3 FM (`kexp`): **12** (0 exact / 12 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 145 | Drugdealer | **13** | 1 | 12 | KEXP 90.3 FM (`kexp`): **11** (1 exact / 10 artist)<br>Dublab (`dublab`): **1** (0 exact / 1 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 146 | Fuzz | **13** | 1 | 12 | KEXP 90.3 FM (`kexp`): **13** (1 exact / 12 artist) |
| 147 | Levitation Room | **13** | 0 | 13 | KEXP 90.3 FM (`kexp`): **13** (0 exact / 13 artist) |
| 148 | Pat Benatar | **13** | 1 | 12 | KEXP 90.3 FM (`kexp`): **10** (1 exact / 9 artist)<br>80s Alive (`80s-alive`): **1** (0 exact / 1 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **1** (0 exact / 1 artist) |
| 149 | The Holydrug Couple | **13** | 1 | 12 | KEXP 90.3 FM (`kexp`): **13** (1 exact / 12 artist) |
| 150 | Thee Oh Sees | **13** | 0 | 13 | KEXP 90.3 FM (`kexp`): **13** (0 exact / 13 artist) |
| 151 | Arc De Soleil | **12** | 2 | 10 | KEXP 90.3 FM (`kexp`): **12** (2 exact / 10 artist) |
| 152 | Chat Pile | **12** | 0 | 12 | KEXP 90.3 FM (`kexp`): **12** (0 exact / 12 artist) |
| 153 | Deafheaven | **12** | 1 | 11 | KEXP 90.3 FM (`kexp`): **12** (1 exact / 11 artist) |
| 154 | Dylan Henner | **12** | 0 | 12 | KEXP 90.3 FM (`kexp`): **12** (0 exact / 12 artist) |
| 155 | Empire of the Sun | **12** | 0 | 12 | KEXP 90.3 FM (`kexp`): **12** (0 exact / 12 artist) |
| 156 | Morrissey | **12** | 0 | 12 | FIP Rock (`fip-rock`): **2** (0 exact / 2 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **2** (0 exact / 2 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **2** (0 exact / 2 artist)<br>KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist)<br>New Wave Radio (`new-wave-radio`): **2** (0 exact / 2 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **1** (0 exact / 1 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **1** (0 exact / 1 artist) |
| 157 | The Nude Party | **12** | 0 | 12 | KEXP 90.3 FM (`kexp`): **12** (0 exact / 12 artist) |
| 158 | Chris Cornell | **11** | 1 | 10 | KEXP 90.3 FM (`kexp`): **11** (1 exact / 10 artist) |
| 159 | Emerson, Lake & Palmer | **11** | 0 | 11 | KEXP 90.3 FM (`kexp`): **11** (0 exact / 11 artist) |
| 160 | Ratatat | **11** | 4 | 7 | KEXP 90.3 FM (`kexp`): **10** (3 exact / 7 artist)<br>FIP Rock (`fip-rock`): **1** (1 exact / 0 artist) |
| 161 | Toadies | **11** | 0 | 11 | KEXP 90.3 FM (`kexp`): **11** (0 exact / 11 artist) |
| 162 | Vulfpeck | **11** | 4 | 7 | KEXP 90.3 FM (`kexp`): **9** (3 exact / 6 artist)<br>FIP Groove (`fip-groove`): **2** (1 exact / 1 artist) |
| 163 | Altın Gün | **10** | 3 | 7 | KEXP 90.3 FM (`kexp`): **7** (3 exact / 4 artist)<br>FIP World (`fip-world`): **2** (0 exact / 2 artist)<br>FIP Groove (`fip-groove`): **1** (0 exact / 1 artist) |
| 164 | Delta Sleep | **10** | 0 | 10 | KEXP 90.3 FM (`kexp`): **10** (0 exact / 10 artist) |
| 165 | Discovery Zone | **10** | 0 | 10 | KEXP 90.3 FM (`kexp`): **10** (0 exact / 10 artist) |
| 166 | Jon Hopkins | **10** | 0 | 10 | KEXP 90.3 FM (`kexp`): **10** (0 exact / 10 artist) |
| 167 | Light Asylum | **10** | 2 | 8 | KEXP 90.3 FM (`kexp`): **10** (2 exact / 8 artist) |
| 168 | Pearl Jam | **10** | 9 | 1 | KEXP 90.3 FM (`kexp`): **9** (8 exact / 1 artist)<br>FIP Rock (`fip-rock`): **1** (1 exact / 0 artist) |
| 169 | Rufus & Chaka Khan | **10** | 0 | 10 | KEXP 90.3 FM (`kexp`): **10** (0 exact / 10 artist) |
| 170 | The HU | **10** | 0 | 10 | KEXP 90.3 FM (`kexp`): **8** (0 exact / 8 artist)<br>Radio Caprice - Folk Metal (`radio-caprice-folk-metal`): **2** (0 exact / 2 artist) |
| 171 | Title Fight | **10** | 1 | 9 | KEXP 90.3 FM (`kexp`): **10** (1 exact / 9 artist) |
| 172 | Die Spitz | **9** | 3 | 6 | KEXP 90.3 FM (`kexp`): **9** (3 exact / 6 artist) |
| 173 | Guns N’ Roses | **9** | 0 | 9 | KEXP 90.3 FM (`kexp`): **7** (0 exact / 7 artist)<br>80s Alive (`80s-alive`): **1** (0 exact / 1 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 174 | John Maus | **9** | 0 | 9 | KEXP 90.3 FM (`kexp`): **8** (0 exact / 8 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 175 | Sleepy Sun | **9** | 1 | 8 | KEXP 90.3 FM (`kexp`): **5** (1 exact / 4 artist)<br>Radio Caprice - Psychedelic Folk (`radio-caprice-psychedelic-folk`): **4** (0 exact / 4 artist) |
| 176 | Smiths | **9** | 0 | 9 | New Wave - BestNet Radio (`new-wave-bestnet-radio`): **3** (0 exact / 3 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **2** (0 exact / 2 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **2** (0 exact / 2 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist)<br>New Wave Radio (`new-wave-radio`): **1** (0 exact / 1 artist) |
| 177 | Sugar Candy Mountain | **9** | 9 | 0 | KEXP 90.3 FM (`kexp`): **8** (8 exact / 0 artist)<br>FIP Rock (`fip-rock`): **1** (1 exact / 0 artist) |
| 178 | The Alan Parsons Project | **9** | 0 | 9 | KEXP 90.3 FM (`kexp`): **6** (0 exact / 6 artist)<br>Gen X Radio (`gen-x-radio`): **2** (0 exact / 2 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 179 | The Dukes of Stratosphear | **9** | 0 | 9 | KEXP 90.3 FM (`kexp`): **9** (0 exact / 9 artist) |
| 180 | The Lazy Eyes | **9** | 2 | 7 | KEXP 90.3 FM (`kexp`): **9** (2 exact / 7 artist) |
| 181 | Tom Tom Club | **9** | 9 | 0 | KEXP 90.3 FM (`kexp`): **2** (2 exact / 0 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **1** (1 exact / 0 artist)<br>FIP Rock (`fip-rock`): **1** (1 exact / 0 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (1 exact / 0 artist)<br>New Wave Radio (`new-wave-radio`): **1** (1 exact / 0 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **1** (1 exact / 0 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **1** (1 exact / 0 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **1** (1 exact / 0 artist) |
| 182 | Bone Thugs-N-Harmony | **8** | 0 | 8 | KEXP 90.3 FM (`kexp`): **8** (0 exact / 8 artist) |
| 183 | Colourbox | **8** | 0 | 8 | KEXP 90.3 FM (`kexp`): **6** (0 exact / 6 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **1** (0 exact / 1 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **1** (0 exact / 1 artist) |
| 184 | Creedence Clearwater Revival | **8** | 5 | 3 | FIP Rock (`fip-rock`): **4** (1 exact / 3 artist)<br>KEXP 90.3 FM (`kexp`): **2** (2 exact / 0 artist)<br>All Oldies Channel (`all-oldies-channel`): **1** (1 exact / 0 artist)<br>Gen X Radio (`gen-x-radio`): **1** (1 exact / 0 artist) |
| 185 | Hum | **8** | 1 | 7 | KEXP 90.3 FM (`kexp`): **8** (1 exact / 7 artist) |
| 186 | levitation room | **8** | 1 | 7 | KEXP 90.3 FM (`kexp`): **8** (1 exact / 7 artist) |
| 187 | Mulatu Astatke | **8** | 0 | 8 | KEXP 90.3 FM (`kexp`): **7** (0 exact / 7 artist)<br>FIP World (`fip-world`): **1** (0 exact / 1 artist) |
| 188 | Tim Hecker | **8** | 0 | 8 | KEXP 90.3 FM (`kexp`): **6** (0 exact / 6 artist)<br>RADCAP: DRONE AMBIENT (`radcap-drone-ambient`): **2** (0 exact / 2 artist) |
| 189 | Topographies | **8** | 0 | 8 | KEXP 90.3 FM (`kexp`): **8** (0 exact / 8 artist) |
| 190 | Vitamin String Quartet | **8** | 0 | 8 | KEXP 90.3 FM (`kexp`): **8** (0 exact / 8 artist) |
| 191 | Delicate Steve | **7** | 1 | 6 | KEXP 90.3 FM (`kexp`): **7** (1 exact / 6 artist) |
| 192 | Deradoorian | **7** | 1 | 6 | KEXP 90.3 FM (`kexp`): **7** (1 exact / 6 artist) |
| 193 | L'Eclair | **7** | 1 | 6 | KEXP 90.3 FM (`kexp`): **7** (1 exact / 6 artist) |
| 194 | Pye Corner Audio | **7** | 0 | 7 | KEXP 90.3 FM (`kexp`): **7** (0 exact / 7 artist) |
| 195 | REM | **7** | 0 | 7 | GEM New Wave Radio (`gem-new-wave-radio`): **3** (0 exact / 3 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **3** (0 exact / 3 artist)<br>Gen X Radio (`gen-x-radio`): **1** (0 exact / 1 artist) |
| 196 | SLIFT | **7** | 0 | 7 | KEXP 90.3 FM (`kexp`): **7** (0 exact / 7 artist) |
| 197 | The Black Dog | **7** | 1 | 6 | KEXP 90.3 FM (`kexp`): **5** (1 exact / 4 artist)<br>Radio Caprice - Experimental Techno [2] (`radio-caprice-experimental-techno-2`): **1** (0 exact / 1 artist)<br>SomaFM — CliqHop IDM (`somafm-cliqhop`): **1** (0 exact / 1 artist) |
| 198 | The Claypool Lennon Delirium | **7** | 1 | 6 | KEXP 90.3 FM (`kexp`): **7** (1 exact / 6 artist) |
| 199 | The Glove | **7** | 0 | 7 | KEXP 90.3 FM (`kexp`): **7** (0 exact / 7 artist) |
| 200 | The Sisters Of Mercy | **7** | 0 | 7 | New Wave - BestNet Radio (`new-wave-bestnet-radio`): **4** (0 exact / 4 artist)<br>80's New Wave Radio (`80-s-new-wave-radio`): **3** (0 exact / 3 artist) |
| 201 | 2 Chainz | **6** | 0 | 6 | KEXP 90.3 FM (`kexp`): **6** (0 exact / 6 artist) |
| 202 | Alain Goraguer | **6** | 0 | 6 | KEXP 90.3 FM (`kexp`): **6** (0 exact / 6 artist) |
| 203 | At the Drive‐In | **6** | 0 | 6 | KEXP 90.3 FM (`kexp`): **6** (0 exact / 6 artist) |
| 204 | Brian Wilson | **6** | 0 | 6 | KEXP 90.3 FM (`kexp`): **6** (0 exact / 6 artist) |
| 205 | David Gilmour | **6** | 1 | 5 | FIP Rock (`fip-rock`): **4** (1 exact / 3 artist)<br>KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 206 | Fiction Factory | **6** | 6 | 0 | Gen X Radio (`gen-x-radio`): **1** (1 exact / 0 artist)<br>KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist)<br>New Wave Radio (`new-wave-radio`): **1** (1 exact / 0 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **1** (1 exact / 0 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **1** (1 exact / 0 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **1** (1 exact / 0 artist) |
| 207 | Imaginary Softwoods | **6** | 0 | 6 | KEXP 90.3 FM (`kexp`): **6** (0 exact / 6 artist) |
| 208 | James Gang | **6** | 1 | 5 | KEXP 90.3 FM (`kexp`): **5** (0 exact / 5 artist)<br>FIP Rock (`fip-rock`): **1** (1 exact / 0 artist) |
| 209 | Jessica Lea Mayfield | **6** | 0 | 6 | KEXP 90.3 FM (`kexp`): **6** (0 exact / 6 artist) |
| 210 | Jim Croce | **6** | 0 | 6 | KEXP 90.3 FM (`kexp`): **5** (0 exact / 5 artist)<br>All Oldies Channel (`all-oldies-channel`): **1** (0 exact / 1 artist) |
| 211 | Pelican | **6** | 0 | 6 | KEXP 90.3 FM (`kexp`): **6** (0 exact / 6 artist) |
| 212 | Public Image LTD. | **6** | 6 | 0 | GEM New Wave Radio (`gem-new-wave-radio`): **1** (1 exact / 0 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **1** (1 exact / 0 artist)<br>KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (1 exact / 0 artist)<br>New Wave Radio (`new-wave-radio`): **1** (1 exact / 0 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **1** (1 exact / 0 artist) |
| 213 | Refused | **6** | 0 | 6 | KEXP 90.3 FM (`kexp`): **6** (0 exact / 6 artist) |
| 214 | Rozi Plain | **6** | 2 | 4 | KEXP 90.3 FM (`kexp`): **4** (1 exact / 3 artist)<br>FIP Rock (`fip-rock`): **2** (1 exact / 1 artist) |
| 215 | Slothrust | **6** | 0 | 6 | KEXP 90.3 FM (`kexp`): **6** (0 exact / 6 artist) |
| 216 | St. Paul & The Broken Bones | **6** | 0 | 6 | KEXP 90.3 FM (`kexp`): **6** (0 exact / 6 artist) |
| 217 | Tenacious D | **6** | 0 | 6 | KEXP 90.3 FM (`kexp`): **6** (0 exact / 6 artist) |
| 218 | The Bobby Fuller Four | **6** | 1 | 5 | KEXP 90.3 FM (`kexp`): **6** (1 exact / 5 artist) |
| 219 | The Field | **6** | 0 | 6 | KEXP 90.3 FM (`kexp`): **6** (0 exact / 6 artist) |
| 220 | Thomas Fehlmann | **6** | 0 | 6 | Radio Caprice - Experimental Techno [2] (`radio-caprice-experimental-techno-2`): **4** (0 exact / 4 artist)<br>SomaFM — CliqHop IDM (`somafm-cliqhop`): **2** (0 exact / 2 artist) |
| 221 | 16 Horsepower | **5** | 0 | 5 | KEXP 90.3 FM (`kexp`): **5** (0 exact / 5 artist) |
| 222 | Astrid Sonne | **5** | 0 | 5 | KEXP 90.3 FM (`kexp`): **5** (0 exact / 5 artist) |
| 223 | Big Brother & the Holding Company | **5** | 0 | 5 | KEXP 90.3 FM (`kexp`): **5** (0 exact / 5 artist) |
| 224 | Counting Crows | **5** | 0 | 5 | KEXP 90.3 FM (`kexp`): **5** (0 exact / 5 artist) |
| 225 | Dave Matthews Band | **5** | 0 | 5 | KEXP 90.3 FM (`kexp`): **5** (0 exact / 5 artist) |
| 226 | Dick Dale | **5** | 0 | 5 | KEXP 90.3 FM (`kexp`): **5** (0 exact / 5 artist) |
| 227 | Donnie & Joe Emerson | **5** | 2 | 3 | KEXP 90.3 FM (`kexp`): **5** (2 exact / 3 artist) |
| 228 | Graham Nash | **5** | 0 | 5 | KEXP 90.3 FM (`kexp`): **4** (0 exact / 4 artist)<br>All Oldies Channel (`all-oldies-channel`): **1** (0 exact / 1 artist) |
| 229 | Hurray for the Riff Raff | **5** | 1 | 4 | FIP Rock (`fip-rock`): **2** (1 exact / 1 artist)<br>KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist)<br>SomaFM Folk Forward (128k AAC) (`somafm-folk-forward-128k-aac`): **1** (0 exact / 1 artist)<br>SomaFM Folk Forward (128k MP3) (`somafm-folk-forward-128k-mp3`): **1** (0 exact / 1 artist) |
| 230 | Journey | **5** | 1 | 4 | KEXP 90.3 FM (`kexp`): **4** (1 exact / 3 artist)<br>Gen X Radio (`gen-x-radio`): **1** (0 exact / 1 artist) |
| 231 | Leon Vynehall | **5** | 0 | 5 | KEXP 90.3 FM (`kexp`): **5** (0 exact / 5 artist) |
| 232 | Li Yilei | **5** | 0 | 5 | KEXP 90.3 FM (`kexp`): **5** (0 exact / 5 artist) |
| 233 | Monolord | **5** | 1 | 4 | KEXP 90.3 FM (`kexp`): **5** (1 exact / 4 artist) |
| 234 | Mr. Bungle | **5** | 0 | 5 | KEXP 90.3 FM (`kexp`): **5** (0 exact / 5 artist) |
| 235 | Murcof | **5** | 0 | 5 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist)<br>SomaFM — CliqHop IDM (`somafm-cliqhop`): **2** (0 exact / 2 artist)<br>Radio Caprice - Experimental Techno [2] (`radio-caprice-experimental-techno-2`): **1** (0 exact / 1 artist) |
| 236 | Noonday Underground | **5** | 2 | 3 | KEXP 90.3 FM (`kexp`): **4** (1 exact / 3 artist)<br>FIP Rock (`fip-rock`): **1** (1 exact / 0 artist) |
| 237 | POLIÇA | **5** | 0 | 5 | KEXP 90.3 FM (`kexp`): **5** (0 exact / 5 artist) |
| 238 | Rachika Nayar | **5** | 0 | 5 | KEXP 90.3 FM (`kexp`): **5** (0 exact / 5 artist) |
| 239 | Son Lux | **5** | 0 | 5 | KEXP 90.3 FM (`kexp`): **5** (0 exact / 5 artist) |
| 240 | T-Rex | **5** | 0 | 5 | Gen X Radio (`gen-x-radio`): **2** (0 exact / 2 artist)<br>KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist)<br>All Oldies Channel (`all-oldies-channel`): **1** (0 exact / 1 artist) |
| 241 | Taleen Kali | **5** | 1 | 4 | KEXP 90.3 FM (`kexp`): **5** (1 exact / 4 artist) |
| 242 | The Psychedelic Aliens | **5** | 1 | 4 | KEXP 90.3 FM (`kexp`): **5** (1 exact / 4 artist) |
| 243 | Yin Yin | **5** | 0 | 5 | KEXP 90.3 FM (`kexp`): **4** (0 exact / 4 artist)<br>FIP Groove (`fip-groove`): **1** (0 exact / 1 artist) |
| 244 | Brian Jonestown Massacre | **4** | 0 | 4 | KEXP 90.3 FM (`kexp`): **3** (0 exact / 3 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 245 | Ed O’Brien | **4** | 0 | 4 | KEXP 90.3 FM (`kexp`): **4** (0 exact / 4 artist) |
| 246 | Elder | **4** | 0 | 4 | KEXP 90.3 FM (`kexp`): **4** (0 exact / 4 artist) |
| 247 | Forest Swords | **4** | 0 | 4 | KEXP 90.3 FM (`kexp`): **4** (0 exact / 4 artist) |
| 248 | GoGo Penguin | **4** | 0 | 4 | FIP Jazz (`fip-jazz`): **2** (0 exact / 2 artist)<br>KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 249 | Hans Zimmer | **4** | 0 | 4 | KEXP 90.3 FM (`kexp`): **4** (0 exact / 4 artist) |
| 250 | Heathered Pearls | **4** | 0 | 4 | KEXP 90.3 FM (`kexp`): **4** (0 exact / 4 artist) |
| 251 | Ishmael Ensemble | **4** | 0 | 4 | KEXP 90.3 FM (`kexp`): **4** (0 exact / 4 artist) |
| 252 | Karnivool | **4** | 0 | 4 | KEXP 90.3 FM (`kexp`): **4** (0 exact / 4 artist) |
| 253 | King Woman | **4** | 2 | 2 | KEXP 90.3 FM (`kexp`): **4** (2 exact / 2 artist) |
| 254 | Kyuss | **4** | 0 | 4 | KEXP 90.3 FM (`kexp`): **4** (0 exact / 4 artist) |
| 255 | Lo Moon | **4** | 0 | 4 | KEXP 90.3 FM (`kexp`): **4** (0 exact / 4 artist) |
| 256 | Max Cooper | **4** | 0 | 4 | Radio Caprice - Experimental Techno [2] (`radio-caprice-experimental-techno-2`): **2** (0 exact / 2 artist)<br>KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist)<br>SomaFM — CliqHop IDM (`somafm-cliqhop`): **1** (0 exact / 1 artist) |
| 257 | Mystic Braves | **4** | 0 | 4 | KEXP 90.3 FM (`kexp`): **4** (0 exact / 4 artist) |
| 258 | PETER GABRIEL | **4** | 0 | 4 | 80's New Wave Radio (`80-s-new-wave-radio`): **1** (0 exact / 1 artist)<br>New Wave Radio (`new-wave-radio`): **1** (0 exact / 1 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **1** (0 exact / 1 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **1** (0 exact / 1 artist) |
| 259 | Peter Schilling | **4** | 4 | 0 | 80's New Wave Radio (`80-s-new-wave-radio`): **1** (1 exact / 0 artist)<br>GEM New Wave Radio (`gem-new-wave-radio`): **1** (1 exact / 0 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **1** (1 exact / 0 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **1** (1 exact / 0 artist) |
| 260 | PINK FLOYD | **4** | 2 | 2 | FIP Rock (`fip-rock`): **2** (1 exact / 1 artist)<br>24-7 Psychedelic Rock (`24-7-psychedelic-rock`): **1** (0 exact / 1 artist)<br>KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 261 | Russian Circles | **4** | 1 | 3 | KEXP 90.3 FM (`kexp`): **4** (1 exact / 3 artist) |
| 262 | Sea Wolf | **4** | 1 | 3 | KEXP 90.3 FM (`kexp`): **4** (1 exact / 3 artist) |
| 263 | Sisters of Mercy | **4** | 0 | 4 | GEM New Wave Radio (`gem-new-wave-radio`): **2** (0 exact / 2 artist)<br>Gem Radio New Wave (`gem-radio-new-wave`): **2** (0 exact / 2 artist) |
| 264 | Sleep | **4** | 0 | 4 | KEXP 90.3 FM (`kexp`): **4** (0 exact / 4 artist) |
| 265 | Suicide | **4** | 4 | 0 | KEXP 90.3 FM (`kexp`): **4** (4 exact / 0 artist) |
| 266 | The Flaming Lips | **4** | 4 | 0 | KEXP 90.3 FM (`kexp`): **4** (4 exact / 0 artist) |
| 267 | The Observers | **4** | 0 | 4 | FIP Reggae (`fip-reggae`): **3** (0 exact / 3 artist)<br>KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 268 | The Psychedelic Furs | **4** | 4 | 0 | KEXP 90.3 FM (`kexp`): **2** (2 exact / 0 artist)<br>FIP Rock (`fip-rock`): **1** (1 exact / 0 artist)<br>New Wave Radio (`new-wave-radio`): **1** (1 exact / 0 artist) |
| 269 | The Sword | **4** | 0 | 4 | KEXP 90.3 FM (`kexp`): **4** (0 exact / 4 artist) |
| 270 | Ulver | **4** | 0 | 4 | KEXP 90.3 FM (`kexp`): **3** (0 exact / 3 artist)<br>RADCAP: DRONE AMBIENT (`radcap-drone-ambient`): **1** (0 exact / 1 artist) |
| 271 | When In Rome | **4** | 4 | 0 | New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (1 exact / 0 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **1** (1 exact / 0 artist)<br>SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **1** (1 exact / 0 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **1** (1 exact / 0 artist) |
| 272 | A Perfect Circle | **3** | 0 | 3 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 273 | Anthony Linell | **3** | 0 | 3 | Radio Caprice - Experimental Techno [2] (`radio-caprice-experimental-techno-2`): **3** (0 exact / 3 artist) |
| 274 | Ariel Pink | **3** | 0 | 3 | KEXP 90.3 FM (`kexp`): **3** (0 exact / 3 artist) |
| 275 | Beach House | **3** | 1 | 2 | KEXP 90.3 FM (`kexp`): **3** (1 exact / 2 artist) |
| 276 | Broadcast | **3** | 2 | 1 | KEXP 90.3 FM (`kexp`): **3** (2 exact / 1 artist) |
| 277 | Chris Squire | **3** | 0 | 3 | KEXP 90.3 FM (`kexp`): **3** (0 exact / 3 artist) |
| 278 | Connan Mockasin | **3** | 3 | 0 | KEXP 90.3 FM (`kexp`): **2** (2 exact / 0 artist)<br>FIP Rock (`fip-rock`): **1** (1 exact / 0 artist) |
| 279 | Crosby & Nash | **3** | 0 | 3 | KEXP 90.3 FM (`kexp`): **3** (0 exact / 3 artist) |
| 280 | Don Henley | **3** | 0 | 3 | 80s Alive (`80s-alive`): **1** (0 exact / 1 artist)<br>All Oldies Channel (`all-oldies-channel`): **1** (0 exact / 1 artist)<br>KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 281 | Eagles | **3** | 2 | 1 | FIP Rock (`fip-rock`): **2** (1 exact / 1 artist)<br>KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 282 | Father John Misty | **3** | 3 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist)<br>SomaFM Folk Forward (128k AAC) (`somafm-folk-forward-128k-aac`): **1** (1 exact / 0 artist)<br>SomaFM Folk Forward (128k MP3) (`somafm-folk-forward-128k-mp3`): **1** (1 exact / 0 artist) |
| 283 | Glen Campbell | **3** | 3 | 0 | All Oldies Channel (`all-oldies-channel`): **1** (1 exact / 0 artist)<br>FIP Rock (`fip-rock`): **1** (1 exact / 0 artist)<br>Gen X Radio (`gen-x-radio`): **1** (1 exact / 0 artist) |
| 284 | Glove | **3** | 0 | 3 | KEXP 90.3 FM (`kexp`): **3** (0 exact / 3 artist) |
| 285 | Jerry Garcia Band | **3** | 0 | 3 | KEXP 90.3 FM (`kexp`): **3** (0 exact / 3 artist) |
| 286 | Joe Jackson | **3** | 3 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist)<br>New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (1 exact / 0 artist)<br>New Wave Radio (`new-wave-radio`): **1** (1 exact / 0 artist) |
| 287 | Kadavar | **3** | 0 | 3 | KEXP 90.3 FM (`kexp`): **3** (0 exact / 3 artist) |
| 288 | Mark Morrison | **3** | 3 | 0 | Gen X Radio (`gen-x-radio`): **1** (1 exact / 0 artist)<br>Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (1 exact / 0 artist)<br>KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 289 | Mazzy Star | **3** | 3 | 0 | FIP Rock (`fip-rock`): **1** (1 exact / 0 artist)<br>KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist)<br>SomaFM — Lush (`somafm-lush`): **1** (1 exact / 0 artist) |
| 290 | Nathan Micay | **3** | 0 | 3 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist)<br>FIP Electro (`fip-electro`): **1** (0 exact / 1 artist) |
| 291 | Pile | **3** | 1 | 2 | KEXP 90.3 FM (`kexp`): **3** (1 exact / 2 artist) |
| 292 | Robert Palmer | **3** | 3 | 0 | FIP Electro (`fip-electro`): **1** (1 exact / 0 artist)<br>Gen X Radio (`gen-x-radio`): **1** (1 exact / 0 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **1** (1 exact / 0 artist) |
| 293 | Rollins Band | **3** | 0 | 3 | KEXP 90.3 FM (`kexp`): **3** (0 exact / 3 artist) |
| 294 | Shed | **3** | 0 | 3 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist)<br>FIP Electro (`fip-electro`): **1** (0 exact / 1 artist) |
| 295 | Slift | **3** | 0 | 3 | KEXP 90.3 FM (`kexp`): **3** (0 exact / 3 artist) |
| 296 | Soft Kill | **3** | 0 | 3 | KEXP 90.3 FM (`kexp`): **3** (0 exact / 3 artist) |
| 297 | Surprise Chef | **3** | 1 | 2 | KEXP 90.3 FM (`kexp`): **2** (1 exact / 1 artist)<br>Worldwide FM (`worldwide-fm`): **1** (0 exact / 1 artist) |
| 298 | Tame Impala | **3** | 3 | 0 | KEXP 90.3 FM (`kexp`): **2** (2 exact / 0 artist)<br>FIP Rock (`fip-rock`): **1** (1 exact / 0 artist) |
| 299 | The Budos Band | **3** | 3 | 0 | KEXP 90.3 FM (`kexp`): **3** (3 exact / 0 artist) |
| 300 | The Donnas | **3** | 3 | 0 | KEXP 90.3 FM (`kexp`): **3** (3 exact / 0 artist) |
| 301 | The Foundations | **3** | 0 | 3 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist)<br>Gen X Radio (`gen-x-radio`): **1** (0 exact / 1 artist) |
| 302 | The Growlers | **3** | 0 | 3 | KEXP 90.3 FM (`kexp`): **3** (0 exact / 3 artist) |
| 303 | They Are Gutting a Body of Water | **3** | 0 | 3 | KEXP 90.3 FM (`kexp`): **3** (0 exact / 3 artist) |
| 304 | This Will Destroy You | **3** | 0 | 3 | KEXP 90.3 FM (`kexp`): **3** (0 exact / 3 artist) |
| 305 | Trex | **3** | 0 | 3 | KEXP 90.3 FM (`kexp`): **3** (0 exact / 3 artist) |
| 306 | UFO | **3** | 0 | 3 | KEXP 90.3 FM (`kexp`): **3** (0 exact / 3 artist) |
| 307 | Viagra Boys | **3** | 2 | 1 | KEXP 90.3 FM (`kexp`): **3** (2 exact / 1 artist) |
| 308 | Alessandro Cortini | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 309 | Amtrac | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 310 | Anthony Moore | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 311 | Automatic | **2** | 2 | 0 | KEXP 90.3 FM (`kexp`): **2** (2 exact / 0 artist) |
| 312 | Beach Boys | **2** | 0 | 2 | All Oldies Channel (`all-oldies-channel`): **2** (0 exact / 2 artist) |
| 313 | Blackwater Holylight | **2** | 2 | 0 | KEXP 90.3 FM (`kexp`): **2** (2 exact / 0 artist) |
| 314 | Carrellee | **2** | 1 | 1 | KEXP 90.3 FM (`kexp`): **2** (1 exact / 1 artist) |
| 315 | Cheekface | **2** | 2 | 0 | KEXP 90.3 FM (`kexp`): **2** (2 exact / 0 artist) |
| 316 | Cinnamon Chasers | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 317 | Colour Haze | **2** | 1 | 1 | KEXP 90.3 FM (`kexp`): **2** (1 exact / 1 artist) |
| 318 | Courtesy | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 319 | Cyndi Lauper | **2** | 2 | 0 | 80's New Wave Radio (`80-s-new-wave-radio`): **1** (1 exact / 0 artist)<br>KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 320 | Daniel Rossen | **2** | 2 | 0 | FIP Rock (`fip-rock`): **1** (1 exact / 0 artist)<br>KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 321 | death’s dynamic shroud | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 322 | Dehd | **2** | 2 | 0 | KEXP 90.3 FM (`kexp`): **2** (2 exact / 0 artist) |
| 323 | Donna Summer | **2** | 2 | 0 | Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (1 exact / 0 artist)<br>KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 324 | Dozer | **2** | 1 | 1 | KEXP 90.3 FM (`kexp`): **2** (1 exact / 1 artist) |
| 325 | DURAN DURAN | **2** | 0 | 2 | New Wave Radio (`new-wave-radio`): **1** (0 exact / 1 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **1** (0 exact / 1 artist) |
| 326 | Eloy | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 327 | EURYTHMICS | **2** | 0 | 2 | SomaFM Underground 80s (128k MP3) (`somafm-underground-80s-128k-mp3`): **1** (0 exact / 1 artist)<br>SomaFM Underground 80s (256k MP3) (`somafm-underground-80s-256k-mp3`): **1** (0 exact / 1 artist) |
| 328 | Glaare | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 329 | GORILLAZ | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 330 | Hidden Orchestra | **2** | 0 | 2 | FIP Electro (`fip-electro`): **1** (0 exact / 1 artist)<br>FIP Jazz (`fip-jazz`): **1** (0 exact / 1 artist) |
| 331 | Ian Matthews | **2** | 0 | 2 | All Oldies Channel (`all-oldies-channel`): **1** (0 exact / 1 artist)<br>KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 332 | Iggy Pop & James Williamson | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 333 | In Flames | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 334 | Jack Black | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 335 | James Holden | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist)<br>Radio Caprice - Experimental Techno [2] (`radio-caprice-experimental-techno-2`): **1** (0 exact / 1 artist) |
| 336 | Janis Joplin | **2** | 2 | 0 | KEXP 90.3 FM (`kexp`): **2** (2 exact / 0 artist) |
| 337 | Just Mustard | **2** | 2 | 0 | KEXP 90.3 FM (`kexp`): **2** (2 exact / 0 artist) |
| 338 | Kangding Ray | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 339 | Loathe | **2** | 1 | 1 | KEXP 90.3 FM (`kexp`): **2** (1 exact / 1 artist) |
| 340 | Looking Glass | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 341 | Lorenzo Senni | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 342 | Love | **2** | 2 | 0 | KEXP 90.3 FM (`kexp`): **2** (2 exact / 0 artist) |
| 343 | LVL UP | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 344 | Magic City Hippies | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 345 | Margo Price | **2** | 2 | 0 | KEXP 90.3 FM (`kexp`): **2** (2 exact / 0 artist) |
| 346 | Mdou Moctar | **2** | 2 | 0 | KEXP 90.3 FM (`kexp`): **2** (2 exact / 0 artist) |
| 347 | Mondo Drag | **2** | 1 | 1 | KEXP 90.3 FM (`kexp`): **2** (1 exact / 1 artist) |
| 348 | Mountain | **2** | 2 | 0 | All Oldies Channel (`all-oldies-channel`): **1** (1 exact / 0 artist)<br>KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 349 | Mulatu Astatqé | **2** | 2 | 0 | FIP World (`fip-world`): **1** (1 exact / 0 artist)<br>KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 350 | Nala Sinephro | **2** | 2 | 0 | FIP Electro (`fip-electro`): **1** (1 exact / 0 artist)<br>KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 351 | Nick Gilder | **2** | 0 | 2 | FIP Rock (`fip-rock`): **1** (0 exact / 1 artist)<br>KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 352 | Nicolas Godin | **2** | 2 | 0 | FIP Electro (`fip-electro`): **2** (2 exact / 0 artist) |
| 353 | Palm | **2** | 2 | 0 | KEXP 90.3 FM (`kexp`): **2** (2 exact / 0 artist) |
| 354 | Patti Smith | **2** | 2 | 0 | FIP Rock (`fip-rock`): **1** (1 exact / 0 artist)<br>Sanctuary Radio (Retro 80s Channel) (`sanctuary-radio-retro-80s-channel`): **1** (1 exact / 0 artist) |
| 355 | Paul Banks | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 356 | Police | **2** | 2 | 0 | New Wave - BestNet Radio (`new-wave-bestnet-radio`): **1** (1 exact / 0 artist)<br>New Wave Radio (`new-wave-radio`): **1** (1 exact / 0 artist) |
| 357 | Robbie Robertson | **2** | 2 | 0 | 80s Alive (`80s-alive`): **1** (1 exact / 0 artist)<br>All Oldies Channel (`all-oldies-channel`): **1** (1 exact / 0 artist) |
| 358 | Rolo Tomassi | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 359 | Rosalía | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 360 | Sade | **2** | 2 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist)<br>SomaFM — Lush (`somafm-lush`): **1** (1 exact / 0 artist) |
| 361 | Sofie Birch | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 362 | T Rex | **2** | 2 | 0 | FIP Rock (`fip-rock`): **1** (1 exact / 0 artist)<br>Gen X Radio (`gen-x-radio`): **1** (1 exact / 0 artist) |
| 363 | The Band with Joni Mitchell | **2** | 2 | 0 | KEXP 90.3 FM (`kexp`): **2** (2 exact / 0 artist) |
| 364 | The Breeders | **2** | 2 | 0 | KEXP 90.3 FM (`kexp`): **2** (2 exact / 0 artist) |
| 365 | The Brothers Johnson | **2** | 2 | 0 | Gen X Radio (`gen-x-radio`): **1** (1 exact / 0 artist)<br>KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 366 | The Divine Comedy | **2** | 0 | 2 | FIP Groove (`fip-groove`): **1** (0 exact / 1 artist)<br>FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 367 | The Grateful Dead | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 368 | The Meters | **2** | 2 | 0 | FIP Groove (`fip-groove`): **1** (1 exact / 0 artist)<br>KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 369 | The Red Hot Chili Peppers | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 370 | The Righteous Brothers | **2** | 0 | 2 | All Oldies Channel (`all-oldies-channel`): **1** (0 exact / 1 artist)<br>Suite Jazz Radio (`suite-jazz-radio`): **1** (0 exact / 1 artist) |
| 371 | The Wallflowers | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 372 | Thundercat | **2** | 1 | 1 | KEXP 90.3 FM (`kexp`): **2** (1 exact / 1 artist) |
| 373 | Tom Petty And The Heartbreakers | **2** | 2 | 0 | FIP Rock (`fip-rock`): **2** (2 exact / 0 artist) |
| 374 | Tomasz Bednarczyk | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 375 | Tonstartssbandht | **2** | 1 | 1 | FIP Rock (`fip-rock`): **2** (1 exact / 1 artist) |
| 376 | Truckfighters | **2** | 0 | 2 | KEXP 90.3 FM (`kexp`): **2** (0 exact / 2 artist) |
| 377 | Vieux Farka Touré & Khruangbin | **2** | 2 | 0 | KEXP 90.3 FM (`kexp`): **2** (2 exact / 0 artist) |
| 378 | Whitney Houston | **2** | 2 | 0 | Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (1 exact / 0 artist)<br>KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 379 | Yeah Yeah Yeahs | **2** | 2 | 0 | KEXP 90.3 FM (`kexp`): **2** (2 exact / 0 artist) |
| 380 | Yves Tumor | **2** | 2 | 0 | KEXP 90.3 FM (`kexp`): **2** (2 exact / 0 artist) |
| 381 | 3rd Secret | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 382 | Admo | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 383 | Agriculture | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 384 | Alan Parsons Project | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 385 | Alex Henry Foster | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 386 | Ame | **1** | 1 | 0 | FIP Electro (`fip-electro`): **1** (1 exact / 0 artist) |
| 387 | Amen Dunes | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 388 | AMTRAC | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 389 | Anadol | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 390 | Anna von Hausswolff | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 391 | Aquarium | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 392 | ARC DE SOLEIL | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 393 | Atlanta Rhythm Section | **1** | 1 | 0 | FIP Rock (`fip-rock`): **1** (1 exact / 0 artist) |
| 394 | Barry Can't Swim | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 395 | Bat for Lashes | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 396 | beatles | **1** | 0 | 1 | 24-7 Psychedelic Rock (`24-7-psychedelic-rock`): **1** (0 exact / 1 artist) |
| 397 | BILLY JOEL | **1** | 0 | 1 | Gen X Radio (`gen-x-radio`): **1** (0 exact / 1 artist) |
| 398 | Black Country, New Road | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 399 | Black Midi | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 400 | Blue Material | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 401 | Boards of Canada | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 402 | Bobb Trimble | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 403 | Bodega | **1** | 0 | 1 | FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 404 | Bootsy Collins | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 405 | Boris | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 406 | Brenton Wood | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 407 | Bruce Hornsby | **1** | 0 | 1 | Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist) |
| 408 | Bruce Hornsby and the Range | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 409 | Buena Vista Social Club | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 410 | Cannons | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 411 | Car Seat Headrest | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 412 | Cass Mccombs | **1** | 1 | 0 | FIP Rock (`fip-rock`): **1** (1 exact / 0 artist) |
| 413 | Charlotte Adigery, Bolis Pupul | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 414 | Chromeo feat. Solange | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 415 | Cobra Man | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 416 | Coheed and Cambria | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 417 | Cola | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 418 | Color Green | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 419 | Colour Box | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 420 | Cuffed Up | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 421 | Damien Jurado | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 422 | Dan Deacon | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 423 | Darkside | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 424 | Daryl Hall + John Oates | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 425 | Death Valley Girls | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 426 | Destroyer | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 427 | Doom Gong | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 428 | DOVS | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 429 | Drug Church | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 430 | Dry Cleaning | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 431 | Duran Duran - | **1** | 0 | 1 | All Oldies Channel (`all-oldies-channel`): **1** (0 exact / 1 artist) |
| 432 | Duskus | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 433 | Ecce Shnak | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 434 | Ed O'Brien | **1** | 0 | 1 | FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 435 | Eighth Wonder | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 436 | Electric Citizen | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 437 | Electric Wizard | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 438 | Elton John | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 439 | Empire Of The Sun | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 440 | Everything Everything | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 441 | Far | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 442 | Fleet Foxes | **1** | 1 | 0 | FIP Rock (`fip-rock`): **1** (1 exact / 0 artist) |
| 443 | Fred again.. & The Blessed Madonna | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 444 | Fred Williams | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 445 | G. Love | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 446 | Gang Starr | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 447 | Gang Starr feat. Inspectah Deck | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 448 | Gardens & Villa | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 449 | Genesis Owusu | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 450 | Ghost Power | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 451 | Goldfrapp | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 452 | Gong Gong Gong | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 453 | Greta Van Fleet | **1** | 0 | 1 | FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 454 | Guns N Roses | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 455 | Hank Williams III | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 456 | Herbie Hancock | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 457 | Hiatus Kaiyote | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 458 | HOLY FAWN | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 459 | Holy Fuck | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 460 | Holy Fuck feat. Alexis Taylor | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 461 | Hot Chip | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 462 | Hotline TNT | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 463 | Ibrahim Maalouf | **1** | 1 | 0 | SomaFM — Sonic Universe (`somafm-sonicuniverse`): **1** (1 exact / 0 artist) |
| 464 | ICEAGE | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 465 | Israel Nash | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 466 | Janko Nilovic | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 467 | Jefferson Airplane | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 468 | Jonathan Wilson | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 469 | Kali Malone | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 470 | Khan | **1** | 0 | 1 | SomaFM — Lush (`somafm-lush`): **1** (0 exact / 1 artist) |
| 471 | King Buffalo | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 472 | King Harvest | **1** | 1 | 0 | FIP Rock (`fip-rock`): **1** (1 exact / 0 artist) |
| 473 | Kit Sebastian | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 474 | KOKOROKO | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 475 | Kylie Minogue | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 476 | LADY GAGA | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 477 | Lakeside | **1** | 1 | 0 | All Oldies Channel (`all-oldies-channel`): **1** (1 exact / 0 artist) |
| 478 | LCD Soundsystem | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 479 | LI YILEI | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 480 | Lilacs & Champagne | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 481 | Little Murders | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 482 | Lumerians | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 483 | M83 | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 484 | Madlib | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 485 | Magdalena Bay | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 486 | Mareux | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 487 | Mark Lindsay | **1** | 0 | 1 | FIP Electro (`fip-electro`): **1** (0 exact / 1 artist) |
| 488 | Marlon Williams | **1** | 0 | 1 | FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 489 | Martha Skye Murphy | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 490 | Mastodon | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 491 | Maya Shenfeld | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 492 | MEGA BOG | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 493 | Men I Trust | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 494 | Michael Kiwanuka | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 495 | Midnight Oil | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 496 | Miike Snow | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 497 | Mike & Rich | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 498 | Mildlife | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 499 | Misha Panfilov | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 500 | Molly Tuttle | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 501 | Moon Duo | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 502 | Moses Gunn Collective | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 503 | Mr.Kitty | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 504 | Nathan Fake | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 505 | Naxatras | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 506 | Neu! | **1** | 1 | 0 | FIP Rock (`fip-rock`): **1** (1 exact / 0 artist) |
| 507 | Nico Georis | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 508 | Nilüfer Yanya | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 509 | NINA SIMONE | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 510 | Noura Mint Seymali | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 511 | ODESZA feat. Briana Marela | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 512 | ODESZA feat. Jenni Potts | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 513 | ODESZA feat. Madelyn Grant | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 514 | ODESZA feat. Shy Girls | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 515 | Oh Sees | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 516 | Orchid | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 517 | Orions Belte | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 518 | Parquet Courts | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 519 | Party Dozen | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 520 | Paul Westerberg | **1** | 1 | 0 | FIP Rock (`fip-rock`): **1** (1 exact / 0 artist) |
| 521 | Pavel Milyakov | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 522 | PHIL COLLINS | **1** | 0 | 1 | Intamixx 80s 90s Radio UK (`intamixx-80s-90s-radio-uk`): **1** (0 exact / 1 artist) |
| 523 | PinkPantheress | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 524 | Preoccupations | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 525 | PRINCE | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 526 | Purple Mountains | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 527 | R.I.P. | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 528 | RED HOT CHILI PEPPERS | **1** | 0 | 1 | FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 529 | Robin Trower | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 530 | Roy Orbison | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 531 | Rudy Norman | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 532 | Rufus featuring Chaka Khan | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 533 | Rufus, Chaka Khan | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 534 | Salem | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 535 | SAULT | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 536 | Savatage | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 537 | Serpent Column | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 538 | Sex Blender | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 539 | Shabazz Palaces | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 540 | Shabazz Palaces feat. Thaddillac | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 541 | Shaboozey | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 542 | Sharon Van Etten | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 543 | Sheer Mag | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 544 | Shuggie Otis | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 545 | Silver Apples | **1** | 1 | 0 | FIP Rock (`fip-rock`): **1** (1 exact / 0 artist) |
| 546 | Slomosa | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 547 | Slowly Rolling Camera | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 548 | snuggle | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 549 | SPEED, GLUE & SHINKI | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 550 | Spiral Drive | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 551 | Steve Miller Band | **1** | 0 | 1 | FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 552 | Stevie Wonder | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 553 | Surfing | **1** | 0 | 1 | Radio Caprice - Experimental Techno [2] (`radio-caprice-experimental-techno-2`): **1** (0 exact / 1 artist) |
| 554 | Susumu Yokota | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 555 | Sword | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 556 | T REX | **1** | 1 | 0 | FIP Rock (`fip-rock`): **1** (1 exact / 0 artist) |
| 557 | TEMPLES | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 558 | Temples | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 559 | The  Black Angels | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 560 | The Band and The Staple Singers | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 561 | The Band with Dr. John | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 562 | The Band with Muddy Waters | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 563 | The Band with Orchestra | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 564 | The Blackbyrds | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 565 | THE CACTUS CHANNEL | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 566 | The City Gates | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 567 | The Comet Is Coming | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 568 | The Creatures | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 569 | THE CURE | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 570 | The Dean Ween Group | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 571 | The Gaslight Anthem | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 572 | The Ghost | **1** | 0 | 1 | Radio Caprice - Progressive Folk (`radio-caprice-progressive-folk`): **1** (0 exact / 1 artist) |
| 573 | The Hu | **1** | 0 | 1 | Radio Caprice - Folk Metal (`radio-caprice-folk-metal`): **1** (0 exact / 1 artist) |
| 574 | The Human League | **1** | 1 | 0 | 80's New Wave Radio (`80-s-new-wave-radio`): **1** (1 exact / 0 artist) |
| 575 | The James Gang | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 576 | The Knife | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 577 | The London Suede | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 578 | The Police | **1** | 1 | 0 | FIP Rock (`fip-rock`): **1** (1 exact / 0 artist) |
| 579 | The Smile | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 580 | The Soft Pink Truth | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 581 | The Steve Miller Band | **1** | 1 | 0 | FIP Rock (`fip-rock`): **1** (1 exact / 0 artist) |
| 582 | The Temptations | **1** | 1 | 0 | FIP Groove (`fip-groove`): **1** (1 exact / 0 artist) |
| 583 | The Thievery Corporation | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 584 | The Voidz | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 585 | The War on Drugs | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 586 | The Woods | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 587 | Tom Petty | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 588 | Tom Petty and the Heartbreakers | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 589 | Tomaga | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 590 | Tomahawk | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 591 | Top Drawer | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 592 | Tortoise | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 593 | TR/ST | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 594 | Traveling Wilburys | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 595 | Tropical Fuck Storm | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 596 | True Loves | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 597 | Tyrannosaurus Rex | **1** | 0 | 1 | FIP Rock (`fip-rock`): **1** (0 exact / 1 artist) |
| 598 | U.F.O. | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 599 | U.S. Girls | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 600 | Unto Others | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 601 | Urban Heat | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 602 | Van Morrison | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 603 | Waveshaper | **1** | 0 | 1 | Nightride FM — Chillsynth (`nightride-chillsynth`): **1** (0 exact / 1 artist) |
| 604 | Weezer | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 605 | Whale | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 606 | White Noise | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 607 | Will Van Horn | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 608 | Wings | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 609 | WITCH | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 610 | Wolf People | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 611 | Yaeji feat. Nappy Nina | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 612 | Yo La Tengo | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 613 | Yot Club | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 614 | Yumi Zouma | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |
| 615 | Yusuf / Cat Stevens | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 616 | ZOMBI | **1** | 0 | 1 | KEXP 90.3 FM (`kexp`): **1** (0 exact / 1 artist) |
| 617 | Σtella | **1** | 1 | 0 | KEXP 90.3 FM (`kexp`): **1** (1 exact / 0 artist) |

## Core

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | Prince | **26** | 0 | 26 | FIP (`fip-main`): **13** (0 exact / 13 artist)<br>BBC 6 Music (`bbc-6music`): **12** (0 exact / 12 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 2 | Dolly Parton | **15** | 2 | 13 | BBC 6 Music (`bbc-6music`): **8** (1 exact / 7 artist)<br>FIP (`fip-main`): **7** (1 exact / 6 artist) |
| 3 | Marvin Gaye | **14** | 0 | 14 | BBC 6 Music (`bbc-6music`): **7** (0 exact / 7 artist)<br>FIP (`fip-main`): **5** (0 exact / 5 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **2** (0 exact / 2 artist) |
| 4 | The Beatles | **14** | 0 | 14 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **7** (0 exact / 7 artist)<br>FIP (`fip-main`): **6** (0 exact / 6 artist)<br>BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 5 | Nina Simone | **12** | 1 | 11 | FIP (`fip-main`): **5** (0 exact / 5 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **4** (0 exact / 4 artist)<br>BBC 6 Music (`bbc-6music`): **3** (1 exact / 2 artist) |
| 6 | David Bowie | **10** | 0 | 10 | BBC 6 Music (`bbc-6music`): **4** (0 exact / 4 artist)<br>FIP (`fip-main`): **4** (0 exact / 4 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **2** (0 exact / 2 artist) |
| 7 | The Cure | **10** | 0 | 10 | BBC 6 Music (`bbc-6music`): **6** (0 exact / 6 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **3** (0 exact / 3 artist)<br>FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 8 | Depeche Mode | **9** | 2 | 7 | BBC 6 Music (`bbc-6music`): **8** (1 exact / 7 artist)<br>FIP (`fip-main`): **1** (1 exact / 0 artist) |
| 9 | Talking Heads | **9** | 0 | 9 | BBC 6 Music (`bbc-6music`): **5** (0 exact / 5 artist)<br>FIP (`fip-main`): **3** (0 exact / 3 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 10 | Kate Bush | **7** | 2 | 5 | BBC 6 Music (`bbc-6music`): **4** (2 exact / 2 artist)<br>FIP (`fip-main`): **2** (0 exact / 2 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 11 | The Smiths | **7** | 0 | 7 | BBC 6 Music (`bbc-6music`): **7** (0 exact / 7 artist) |
| 12 | Gorillaz | **6** | 0 | 6 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **3** (0 exact / 3 artist)<br>BBC 6 Music (`bbc-6music`): **2** (0 exact / 2 artist)<br>FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 13 | Kikagaku Moyo | **6** | 0 | 6 | FIP (`fip-main`): **4** (0 exact / 4 artist)<br>BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 14 | Fleetwood Mac | **5** | 0 | 5 | BBC 6 Music (`bbc-6music`): **2** (0 exact / 2 artist)<br>FIP (`fip-main`): **2** (0 exact / 2 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 15 | Khruangbin | **5** | 0 | 5 | BBC 6 Music (`bbc-6music`): **2** (0 exact / 2 artist)<br>FIP (`fip-main`): **2** (0 exact / 2 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 16 | Neil Young | **5** | 0 | 5 | FIP (`fip-main`): **4** (0 exact / 4 artist)<br>BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 17 | Peter Gabriel | **5** | 0 | 5 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **3** (0 exact / 3 artist)<br>FIP (`fip-main`): **1** (0 exact / 1 artist)<br>KUTX 98.9 FM (`kutx`): **1** (0 exact / 1 artist) |
| 18 | Steely Dan | **5** | 5 | 0 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **3** (3 exact / 0 artist)<br>FIP (`fip-main`): **2** (2 exact / 0 artist) |
| 19 | Future Islands | **4** | 0 | 4 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **3** (0 exact / 3 artist)<br>BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 20 | Juana Molina | **4** | 0 | 4 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **3** (0 exact / 3 artist)<br>FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 21 | MGMT | **4** | 1 | 3 | FIP (`fip-main`): **2** (1 exact / 1 artist)<br>BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 22 | Mk.gee | **4** | 0 | 4 | BBC 6 Music (`bbc-6music`): **2** (0 exact / 2 artist)<br>FIP (`fip-main`): **2** (0 exact / 2 artist) |
| 23 | Nirvana | **4** | 0 | 4 | BBC 6 Music (`bbc-6music`): **4** (0 exact / 4 artist) |
| 24 | Red Hot Chili Peppers | **4** | 0 | 4 | FIP (`fip-main`): **3** (0 exact / 3 artist)<br>BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 25 | Underworld | **4** | 0 | 4 | BBC 6 Music (`bbc-6music`): **3** (0 exact / 3 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 26 | Björk | **3** | 0 | 3 | BBC 6 Music (`bbc-6music`): **2** (0 exact / 2 artist)<br>FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 27 | Bombay Bicycle Club | **3** | 0 | 3 | BBC 6 Music (`bbc-6music`): **3** (0 exact / 3 artist) |
| 28 | Chinese American Bear | **3** | 0 | 3 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **2** (0 exact / 2 artist)<br>BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 29 | Fela Kuti | **3** | 1 | 2 | FIP (`fip-main`): **2** (1 exact / 1 artist)<br>BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 30 | Modest Mouse | **3** | 0 | 3 | BBC 6 Music (`bbc-6music`): **2** (0 exact / 2 artist)<br>KUTX 98.9 FM (`kutx`): **1** (0 exact / 1 artist) |
| 31 | Pink Floyd | **3** | 2 | 1 | BBC 6 Music (`bbc-6music`): **2** (2 exact / 0 artist)<br>FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 32 | R.E.M. | **3** | 0 | 3 | BBC 6 Music (`bbc-6music`): **2** (0 exact / 2 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 33 | Sea Wolf | **3** | 1 | 2 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **3** (1 exact / 2 artist) |
| 34 | The Beach Boys | **3** | 0 | 3 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist)<br>FIP (`fip-main`): **1** (0 exact / 1 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 35 | Tony Allen | **3** | 0 | 3 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist)<br>FIP (`fip-main`): **1** (0 exact / 1 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 36 | Vulfpeck | **3** | 2 | 1 | BBC 6 Music (`bbc-6music`): **1** (1 exact / 0 artist)<br>FIP (`fip-main`): **1** (1 exact / 0 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 37 | Altın Gün | **2** | 0 | 2 | FIP (`fip-main`): **1** (0 exact / 1 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 38 | Billy Joel | **2** | 0 | 2 | FIP (`fip-main`): **1** (0 exact / 1 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 39 | Black Sabbath | **2** | 0 | 2 | BBC 6 Music (`bbc-6music`): **2** (0 exact / 2 artist) |
| 40 | Bronski Beat | **2** | 2 | 0 | BBC 6 Music (`bbc-6music`): **1** (1 exact / 0 artist)<br>FIP (`fip-main`): **1** (1 exact / 0 artist) |
| 41 | Chaka Khan | **2** | 0 | 2 | BBC 6 Music (`bbc-6music`): **2** (0 exact / 2 artist) |
| 42 | Deerhoof | **2** | 1 | 1 | BBC 6 Music (`bbc-6music`): **1** (1 exact / 0 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 43 | Deftones | **2** | 0 | 2 | BBC 6 Music (`bbc-6music`): **2** (0 exact / 2 artist) |
| 44 | Drugdealer | **2** | 1 | 1 | FIP (`fip-main`): **1** (1 exact / 0 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 45 | Eurythmics | **2** | 0 | 2 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist)<br>FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 46 | Floating Points | **2** | 0 | 2 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist)<br>FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 47 | Hole | **2** | 0 | 2 | BBC 6 Music (`bbc-6music`): **2** (0 exact / 2 artist) |
| 48 | Jimi Hendrix | **2** | 0 | 2 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist)<br>FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 49 | KOKOROKO | **2** | 1 | 1 | FIP (`fip-main`): **1** (0 exact / 1 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (1 exact / 0 artist) |
| 50 | Kraftwerk | **2** | 0 | 2 | BBC 6 Music (`bbc-6music`): **2** (0 exact / 2 artist) |
| 51 | Low | **2** | 0 | 2 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist)<br>FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 52 | Maxwell | **2** | 0 | 2 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 53 | MJ Lenderman | **2** | 0 | 2 | BBC 6 Music (`bbc-6music`): **2** (0 exact / 2 artist) |
| 54 | Mulatu Astatke | **2** | 0 | 2 | FIP (`fip-main`): **2** (0 exact / 2 artist) |
| 55 | Nancy Sinatra | **2** | 1 | 1 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **2** (1 exact / 1 artist) |
| 56 | Panda Bear | **2** | 0 | 2 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 57 | Patsy Cline | **2** | 1 | 1 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **2** (1 exact / 1 artist) |
| 58 | Paul McCartney | **2** | 0 | 2 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist)<br>FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 59 | Psychedelic Porn Crumpets | **2** | 0 | 2 | FIP (`fip-main`): **2** (0 exact / 2 artist) |
| 60 | ROSALÍA | **2** | 0 | 2 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 61 | Surprise Chef | **2** | 0 | 2 | FIP (`fip-main`): **1** (0 exact / 1 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 62 | T. Rex | **2** | 0 | 2 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist)<br>FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 63 | Tame Impala | **2** | 2 | 0 | FIP (`fip-main`): **1** (1 exact / 0 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (1 exact / 0 artist) |
| 64 | The Brothers Johnson | **2** | 2 | 0 | BBC 6 Music (`bbc-6music`): **1** (1 exact / 0 artist)<br>FIP (`fip-main`): **1** (1 exact / 0 artist) |
| 65 | The Cranberries | **2** | 0 | 2 | BBC 6 Music (`bbc-6music`): **2** (0 exact / 2 artist) |
| 66 | The Divine Comedy | **2** | 0 | 2 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist)<br>FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 67 | The The | **2** | 0 | 2 | BBC 6 Music (`bbc-6music`): **2** (0 exact / 2 artist) |
| 68 | Thievery Corporation | **2** | 0 | 2 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist)<br>KUTX 98.9 FM (`kutx`): **1** (0 exact / 1 artist) |
| 69 | Thundercat | **2** | 2 | 0 | BBC 6 Music (`bbc-6music`): **1** (1 exact / 0 artist)<br>KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (1 exact / 0 artist) |
| 70 | Turnstile | **2** | 0 | 2 | BBC 6 Music (`bbc-6music`): **2** (0 exact / 2 artist) |
| 71 | A Perfect Circle | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 72 | At the Drive-In | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 73 | Bakar | **1** | 1 | 0 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (1 exact / 0 artist) |
| 74 | Beach House | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 75 | Black Moth Super Rainbow | **1** | 0 | 1 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 76 | Boards of Canada | **1** | 1 | 0 | BBC 6 Music (`bbc-6music`): **1** (1 exact / 0 artist) |
| 77 | Bob Marley & The Wailers | **1** | 0 | 1 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 78 | Britney Spears | **1** | 0 | 1 | FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 79 | Broadcast | **1** | 1 | 0 | BBC 6 Music (`bbc-6music`): **1** (1 exact / 0 artist) |
| 80 | Buena Vista Social Club | **1** | 1 | 0 | FIP (`fip-main`): **1** (1 exact / 0 artist) |
| 81 | Chelsea Wolfe | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 82 | Chris Squire | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 83 | Client_03 | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 84 | Crosby, Stills, Nash & Young | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 85 | Dirty Projectors | **1** | 0 | 1 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 86 | Donna Summer | **1** | 1 | 0 | FIP (`fip-main`): **1** (1 exact / 0 artist) |
| 87 | Drug Church | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 88 | Duran Duran | **1** | 0 | 1 | FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 89 | Ed O’Brien | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 90 | Empire of the Sun | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 91 | Everything Everything | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 92 | Foo Fighters | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 93 | Galaxie 500 | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 94 | Genesis | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 95 | Genesis Owusu | **1** | 1 | 0 | BBC 6 Music (`bbc-6music`): **1** (1 exact / 0 artist) |
| 96 | GoGo Penguin | **1** | 0 | 1 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 97 | GORILLAZ | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 98 | Holy Wave | **1** | 0 | 1 | KUTX 98.9 FM (`kutx`): **1** (0 exact / 1 artist) |
| 99 | ICEAGE | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 100 | Iceage | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 101 | King Crimson | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 102 | L'Eclair | **1** | 1 | 0 | FIP (`fip-main`): **1** (1 exact / 0 artist) |
| 103 | La Luz | **1** | 0 | 1 | FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 104 | Lady Gaga | **1** | 0 | 1 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 105 | Madlib | **1** | 1 | 0 | BBC 6 Music (`bbc-6music`): **1** (1 exact / 0 artist) |
| 106 | Mahalia Jackson | **1** | 0 | 1 | FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 107 | Mazzy Star | **1** | 1 | 0 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (1 exact / 0 artist) |
| 108 | Nine Inch Nails | **1** | 0 | 1 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 109 | Orions Belte | **1** | 1 | 0 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (1 exact / 0 artist) |
| 110 | Pearl Jam | **1** | 0 | 1 | FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 111 | PETER GABRIEL | **1** | 0 | 1 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 112 | Public Service Broadcasting | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 113 | Pye Corner Audio | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 114 | Queen | **1** | 0 | 1 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 115 | Ratatat | **1** | 1 | 0 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (1 exact / 0 artist) |
| 116 | Robbie Robertson | **1** | 1 | 0 | BBC 6 Music (`bbc-6music`): **1** (1 exact / 0 artist) |
| 117 | Robert Palmer | **1** | 1 | 0 | FIP (`fip-main`): **1** (1 exact / 0 artist) |
| 118 | Rozi Plain | **1** | 1 | 0 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (1 exact / 0 artist) |
| 119 | Sade | **1** | 1 | 0 | FIP (`fip-main`): **1** (1 exact / 0 artist) |
| 120 | Sofie Birch | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 121 | Stevie Wonder | **1** | 1 | 0 | FIP (`fip-main`): **1** (1 exact / 0 artist) |
| 122 | T REX | **1** | 1 | 0 | FIP (`fip-main`): **1** (1 exact / 0 artist) |
| 123 | Tears For Fears | **1** | 0 | 1 | FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 124 | Teebs | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 125 | The Alan Parsons Project | **1** | 0 | 1 | FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 126 | The Dukes of Stratosphear | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 127 | The Flaming Lips | **1** | 1 | 0 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (1 exact / 0 artist) |
| 128 | The Righteous Brothers | **1** | 1 | 0 | FIP (`fip-main`): **1** (1 exact / 0 artist) |
| 129 | The Sisters Of Mercy | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 130 | The Smashing Pumpkins | **1** | 0 | 1 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 131 | THE SMITHS | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 132 | Todd Rundgren | **1** | 1 | 0 | FIP (`fip-main`): **1** (1 exact / 0 artist) |
| 133 | TOKiMONSTA | **1** | 0 | 1 | KCRW — Eclectic 24 (`kcrw-eclectic24`): **1** (0 exact / 1 artist) |
| 134 | Tom Tom Club | **1** | 1 | 0 | BBC 6 Music (`bbc-6music`): **1** (1 exact / 0 artist) |
| 135 | Tommy Guerrero | **1** | 0 | 1 | FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 136 | Wine Lips | **1** | 0 | 1 | BBC 6 Music (`bbc-6music`): **1** (0 exact / 1 artist) |
| 137 | Woods | **1** | 0 | 1 | FIP (`fip-main`): **1** (0 exact / 1 artist) |
| 138 | Yves Tumor | **1** | 1 | 0 | BBC 6 Music (`bbc-6music`): **1** (1 exact / 0 artist) |

## Public

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | Dolly Parton | **20** | 0 | 20 | CKUA Radio (`ckua`): **15** (0 exact / 15 artist)<br>WDIY 88.1 FM (`wdiy`): **5** (0 exact / 5 artist) |
| 2 | David Bowie | **3** | 0 | 3 | CKUA Radio (`ckua`): **3** (0 exact / 3 artist) |
| 3 | Khruangbin | **3** | 0 | 3 | CKUA Radio (`ckua`): **3** (0 exact / 3 artist) |
| 4 | Marlon Williams | **2** | 1 | 1 | CKUA Radio (`ckua`): **2** (1 exact / 1 artist) |
| 5 | Neil Young | **2** | 0 | 2 | CKUA Radio (`ckua`): **2** (0 exact / 2 artist) |
| 6 | Shuggie Otis | **2** | 1 | 1 | CKUA Radio (`ckua`): **2** (1 exact / 1 artist) |
| 7 | The Band | **2** | 0 | 2 | CKUA Radio (`ckua`): **1** (0 exact / 1 artist)<br>WDIY 88.1 FM (`wdiy`): **1** (0 exact / 1 artist) |
| 8 | The Beatles | **2** | 0 | 2 | CKUA Radio (`ckua`): **2** (0 exact / 2 artist) |
| 9 | Al Di Meola | **1** | 0 | 1 | CKUA Radio (`ckua`): **1** (0 exact / 1 artist) |
| 10 | Bob Marley & The Wailers | **1** | 0 | 1 | CKUA Radio (`ckua`): **1** (0 exact / 1 artist) |
| 11 | Paul McCartney | **1** | 0 | 1 | CKUA Radio (`ckua`): **1** (0 exact / 1 artist) |
| 12 | Peter Gabriel | **1** | 0 | 1 | WDIY 88.1 FM (`wdiy`): **1** (0 exact / 1 artist) |
| 13 | R.E.M. | **1** | 0 | 1 | CKUA Radio (`ckua`): **1** (0 exact / 1 artist) |
| 14 | Talking Heads | **1** | 0 | 1 | CKUA Radio (`ckua`): **1** (0 exact / 1 artist) |
| 15 | The Beach Boys | **1** | 0 | 1 | CKUA Radio (`ckua`): **1** (0 exact / 1 artist) |
| 16 | The Brian Jonestown Massacre | **1** | 0 | 1 | WDIY 88.1 FM (`wdiy`): **1** (0 exact / 1 artist) |
| 17 | The Replacements | **1** | 0 | 1 | CKUA Radio (`ckua`): **1** (0 exact / 1 artist) |
| 18 | Tom Tom Club | **1** | 1 | 0 | CKUA Radio (`ckua`): **1** (1 exact / 0 artist) |

## Independent DJ

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | The Beatles | **30** | 0 | 30 | Super45.fm (`super45-fm`): **22** (0 exact / 22 artist)<br>Yammat FM (`yammat-fm`): **6** (0 exact / 6 artist)<br>Championshipvinyl (`championshipvinyl`): **2** (0 exact / 2 artist) |
| 2 | The Cure | **27** | 0 | 27 | Super45.fm (`super45-fm`): **9** (0 exact / 9 artist)<br>Path through the Forest (`path-through-the-forest`): **7** (0 exact / 7 artist)<br>Yammat FM (`yammat-fm`): **7** (0 exact / 7 artist)<br>HEADY (`heady`): **4** (0 exact / 4 artist) |
| 3 | David Bowie | **24** | 1 | 23 | Yammat FM (`yammat-fm`): **10** (1 exact / 9 artist)<br>Super45.fm (`super45-fm`): **7** (0 exact / 7 artist)<br>Championshipvinyl (`championshipvinyl`): **6** (0 exact / 6 artist)<br>Path through the Forest (`path-through-the-forest`): **1** (0 exact / 1 artist) |
| 4 | Depeche Mode | **21** | 2 | 19 | Yammat FM (`yammat-fm`): **17** (1 exact / 16 artist)<br>Super45.fm (`super45-fm`): **3** (0 exact / 3 artist)<br>HEADY (`heady`): **1** (1 exact / 0 artist) |
| 5 | Pink Floyd | **19** | 9 | 10 | Path through the Forest (`path-through-the-forest`): **14** (6 exact / 8 artist)<br>Championshipvinyl (`championshipvinyl`): **2** (1 exact / 1 artist)<br>Yammat FM (`yammat-fm`): **2** (2 exact / 0 artist)<br>Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 6 | The Smiths | **19** | 3 | 16 | Super45.fm (`super45-fm`): **6** (0 exact / 6 artist)<br>Yammat FM (`yammat-fm`): **5** (0 exact / 5 artist)<br>Championshipvinyl (`championshipvinyl`): **4** (0 exact / 4 artist)<br>HEADY (`heady`): **4** (3 exact / 1 artist) |
| 7 | R.E.M. | **18** | 0 | 18 | Super45.fm (`super45-fm`): **13** (0 exact / 13 artist)<br>Yammat FM (`yammat-fm`): **5** (0 exact / 5 artist) |
| 8 | Future Islands | **15** | 0 | 15 | HEADY (`heady`): **4** (0 exact / 4 artist)<br>Super45.fm (`super45-fm`): **4** (0 exact / 4 artist)<br>Yammat FM (`yammat-fm`): **4** (0 exact / 4 artist)<br>Championshipvinyl (`championshipvinyl`): **3** (0 exact / 3 artist) |
| 9 | Talking Heads | **14** | 0 | 14 | Super45.fm (`super45-fm`): **8** (0 exact / 8 artist)<br>Yammat FM (`yammat-fm`): **6** (0 exact / 6 artist) |
| 10 | The Beach Boys | **13** | 0 | 13 | Super45.fm (`super45-fm`): **9** (0 exact / 9 artist)<br>HEADY (`heady`): **2** (0 exact / 2 artist)<br>Yammat FM (`yammat-fm`): **2** (0 exact / 2 artist) |
| 11 | Kraftwerk | **12** | 0 | 12 | Path through the Forest (`path-through-the-forest`): **8** (0 exact / 8 artist)<br>Super45.fm (`super45-fm`): **2** (0 exact / 2 artist)<br>Yammat FM (`yammat-fm`): **2** (0 exact / 2 artist) |
| 12 | Red Hot Chili Peppers | **12** | 1 | 11 | Yammat FM (`yammat-fm`): **7** (1 exact / 6 artist)<br>HEADY (`heady`): **5** (0 exact / 5 artist) |
| 13 | Tears For Fears | **12** | 1 | 11 | Yammat FM (`yammat-fm`): **6** (1 exact / 5 artist)<br>Championshipvinyl (`championshipvinyl`): **5** (0 exact / 5 artist)<br>Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 14 | Modest Mouse | **11** | 0 | 11 | HEADY (`heady`): **6** (0 exact / 6 artist)<br>Yammat FM (`yammat-fm`): **3** (0 exact / 3 artist)<br>Super45.fm (`super45-fm`): **2** (0 exact / 2 artist) |
| 15 | Prince | **11** | 1 | 10 | Yammat FM (`yammat-fm`): **11** (1 exact / 10 artist) |
| 16 | Underworld | **11** | 0 | 11 | Yammat FM (`yammat-fm`): **10** (0 exact / 10 artist)<br>Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 17 | Gong | **9** | 0 | 9 | Path through the Forest (`path-through-the-forest`): **9** (0 exact / 9 artist) |
| 18 | Khruangbin | **9** | 1 | 8 | Yammat FM (`yammat-fm`): **4** (0 exact / 4 artist)<br>HEADY (`heady`): **3** (1 exact / 2 artist)<br>Super45.fm (`super45-fm`): **2** (0 exact / 2 artist) |
| 19 | Nirvana | **9** | 0 | 9 | HEADY (`heady`): **7** (0 exact / 7 artist)<br>Yammat FM (`yammat-fm`): **2** (0 exact / 2 artist) |
| 20 | Squid | **9** | 0 | 9 | HEADY (`heady`): **8** (0 exact / 8 artist)<br>Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 21 | The Replacements | **9** | 0 | 9 | Super45.fm (`super45-fm`): **9** (0 exact / 9 artist) |
| 22 | The The | **9** | 1 | 8 | Yammat FM (`yammat-fm`): **9** (1 exact / 8 artist) |
| 23 | Thee Oh Sees | **9** | 0 | 9 | HEADY (`heady`): **7** (0 exact / 7 artist)<br>Super45.fm (`super45-fm`): **2** (0 exact / 2 artist) |
| 24 | Psychedelic Porn Crumpets | **8** | 0 | 8 | HEADY (`heady`): **8** (0 exact / 8 artist) |
| 25 | Foo Fighters | **7** | 0 | 7 | Championshipvinyl (`championshipvinyl`): **4** (0 exact / 4 artist)<br>Yammat FM (`yammat-fm`): **3** (0 exact / 3 artist) |
| 26 | MGMT | **7** | 0 | 7 | Yammat FM (`yammat-fm`): **4** (0 exact / 4 artist)<br>HEADY (`heady`): **2** (0 exact / 2 artist)<br>Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 27 | Deftones | **6** | 2 | 4 | HEADY (`heady`): **6** (2 exact / 4 artist) |
| 28 | Fleetwood Mac | **6** | 0 | 6 | HEADY (`heady`): **3** (0 exact / 3 artist)<br>Yammat FM (`yammat-fm`): **2** (0 exact / 2 artist)<br>Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 29 | Gorillaz | **6** | 0 | 6 | Yammat FM (`yammat-fm`): **4** (0 exact / 4 artist)<br>HEADY (`heady`): **2** (0 exact / 2 artist) |
| 30 | Judas Priest | **6** | 0 | 6 | Path through the Forest (`path-through-the-forest`): **6** (0 exact / 6 artist) |
| 31 | Neil Young | **6** | 0 | 6 | Path through the Forest (`path-through-the-forest`): **3** (0 exact / 3 artist)<br>Yammat FM (`yammat-fm`): **3** (0 exact / 3 artist) |
| 32 | The Murlocs | **6** | 1 | 5 | HEADY (`heady`): **6** (1 exact / 5 artist) |
| 33 | Viagra Boys | **6** | 3 | 3 | HEADY (`heady`): **4** (2 exact / 2 artist)<br>Super45.fm (`super45-fm`): **1** (0 exact / 1 artist)<br>Yammat FM (`yammat-fm`): **1** (1 exact / 0 artist) |
| 34 | Acid King | **5** | 0 | 5 | Path through the Forest (`path-through-the-forest`): **5** (0 exact / 5 artist) |
| 35 | Björk | **5** | 0 | 5 | Super45.fm (`super45-fm`): **5** (0 exact / 5 artist) |
| 36 | Creedence Clearwater Revival | **5** | 2 | 3 | Path through the Forest (`path-through-the-forest`): **5** (2 exact / 3 artist) |
| 37 | Jimi Hendrix | **5** | 0 | 5 | Yammat FM (`yammat-fm`): **3** (0 exact / 3 artist)<br>Path through the Forest (`path-through-the-forest`): **2** (0 exact / 2 artist) |
| 38 | Morrissey | **5** | 0 | 5 | Super45.fm (`super45-fm`): **3** (0 exact / 3 artist)<br>Yammat FM (`yammat-fm`): **2** (0 exact / 2 artist) |
| 39 | Peter Gabriel | **5** | 0 | 5 | Yammat FM (`yammat-fm`): **5** (0 exact / 5 artist) |
| 40 | The Blue Nile | **5** | 2 | 3 | Super45.fm (`super45-fm`): **5** (2 exact / 3 artist) |
| 41 | Turnstile | **5** | 0 | 5 | HEADY (`heady`): **3** (0 exact / 3 artist)<br>Super45.fm (`super45-fm`): **1** (0 exact / 1 artist)<br>Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 42 | Beach Fossils | **4** | 0 | 4 | HEADY (`heady`): **2** (0 exact / 2 artist)<br>Super45.fm (`super45-fm`): **2** (0 exact / 2 artist) |
| 43 | Empire of the Sun | **4** | 0 | 4 | Yammat FM (`yammat-fm`): **4** (0 exact / 4 artist) |
| 44 | Eurythmics | **4** | 0 | 4 | Yammat FM (`yammat-fm`): **4** (0 exact / 4 artist) |
| 45 | Hole | **4** | 1 | 3 | Path through the Forest (`path-through-the-forest`): **3** (0 exact / 3 artist)<br>Yammat FM (`yammat-fm`): **1** (1 exact / 0 artist) |
| 46 | Juana Molina | **4** | 0 | 4 | Super45.fm (`super45-fm`): **4** (0 exact / 4 artist) |
| 47 | Kate Bush | **4** | 1 | 3 | Yammat FM (`yammat-fm`): **4** (1 exact / 3 artist) |
| 48 | Kikagaku Moyo | **4** | 1 | 3 | HEADY (`heady`): **4** (1 exact / 3 artist) |
| 49 | Low | **4** | 0 | 4 | Super45.fm (`super45-fm`): **4** (0 exact / 4 artist) |
| 50 | Panda Bear | **4** | 0 | 4 | HEADY (`heady`): **3** (0 exact / 3 artist)<br>Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 51 | Paul McCartney | **4** | 0 | 4 | Super45.fm (`super45-fm`): **2** (0 exact / 2 artist)<br>Yammat FM (`yammat-fm`): **2** (0 exact / 2 artist) |
| 52 | Sigur Rós | **4** | 0 | 4 | Championshipvinyl (`championshipvinyl`): **4** (0 exact / 4 artist) |
| 53 | T. Rex | **4** | 0 | 4 | Super45.fm (`super45-fm`): **3** (0 exact / 3 artist)<br>HEADY (`heady`): **1** (0 exact / 1 artist) |
| 54 | Tears for Fears | **4** | 0 | 4 | Yammat FM (`yammat-fm`): **3** (0 exact / 3 artist)<br>Championshipvinyl (`championshipvinyl`): **1** (0 exact / 1 artist) |
| 55 | The Divine Comedy | **4** | 0 | 4 | Super45.fm (`super45-fm`): **4** (0 exact / 4 artist) |
| 56 | Ariel Pink | **3** | 0 | 3 | Yammat FM (`yammat-fm`): **2** (0 exact / 2 artist)<br>Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 57 | Bauhaus | **3** | 0 | 3 | Super45.fm (`super45-fm`): **2** (0 exact / 2 artist)<br>Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 58 | Billy Idol | **3** | 0 | 3 | Yammat FM (`yammat-fm`): **3** (0 exact / 3 artist) |
| 59 | Black Sabbath | **3** | 0 | 3 | Path through the Forest (`path-through-the-forest`): **2** (0 exact / 2 artist)<br>Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 60 | Chaka Khan | **3** | 0 | 3 | Yammat FM (`yammat-fm`): **3** (0 exact / 3 artist) |
| 61 | Chat Pile | **3** | 0 | 3 | HEADY (`heady`): **3** (0 exact / 3 artist) |
| 62 | Chromeo | **3** | 3 | 0 | Yammat FM (`yammat-fm`): **3** (3 exact / 0 artist) |
| 63 | Dolly Parton | **3** | 1 | 2 | Yammat FM (`yammat-fm`): **3** (1 exact / 2 artist) |
| 64 | Holy Wave | **3** | 0 | 3 | HEADY (`heady`): **3** (0 exact / 3 artist) |
| 65 | La Luz | **3** | 0 | 3 | HEADY (`heady`): **2** (0 exact / 2 artist)<br>Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 66 | Marvin Gaye | **3** | 0 | 3 | Yammat FM (`yammat-fm`): **3** (0 exact / 3 artist) |
| 67 | Mazzy Star | **3** | 3 | 0 | HEADY (`heady`): **1** (1 exact / 0 artist)<br>Super45.fm (`super45-fm`): **1** (1 exact / 0 artist)<br>Yammat FM (`yammat-fm`): **1** (1 exact / 0 artist) |
| 68 | Monolord | **3** | 0 | 3 | Path through the Forest (`path-through-the-forest`): **3** (0 exact / 3 artist) |
| 69 | Nine Inch Nails | **3** | 0 | 3 | HEADY (`heady`): **3** (0 exact / 3 artist) |
| 70 | Queen | **3** | 0 | 3 | Yammat FM (`yammat-fm`): **3** (0 exact / 3 artist) |
| 71 | Sugar Candy Mountain | **3** | 3 | 0 | HEADY (`heady`): **2** (2 exact / 0 artist)<br>Super45.fm (`super45-fm`): **1** (1 exact / 0 artist) |
| 72 | Tangerine Dream | **3** | 0 | 3 | Path through the Forest (`path-through-the-forest`): **1** (0 exact / 1 artist)<br>Super45.fm (`super45-fm`): **1** (0 exact / 1 artist)<br>Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 73 | Temples | **3** | 1 | 2 | HEADY (`heady`): **2** (1 exact / 1 artist)<br>Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 74 | The Pink Floyd | **3** | 0 | 3 | Path through the Forest (`path-through-the-forest`): **3** (0 exact / 3 artist) |
| 75 | Thievery Corporation | **3** | 0 | 3 | Yammat FM (`yammat-fm`): **3** (0 exact / 3 artist) |
| 76 | Woods | **3** | 0 | 3 | Super45.fm (`super45-fm`): **3** (0 exact / 3 artist) |
| 77 | Beach House | **2** | 0 | 2 | Super45.fm (`super45-fm`): **2** (0 exact / 2 artist) |
| 78 | Bombay Bicycle Club | **2** | 0 | 2 | Yammat FM (`yammat-fm`): **2** (0 exact / 2 artist) |
| 79 | Broadcast | **2** | 0 | 2 | Super45.fm (`super45-fm`): **2** (0 exact / 2 artist) |
| 80 | David Byrne | **2** | 1 | 1 | Yammat FM (`yammat-fm`): **2** (1 exact / 1 artist) |
| 81 | Dead Meadow | **2** | 0 | 2 | HEADY (`heady`): **2** (0 exact / 2 artist) |
| 82 | Die Spitz | **2** | 1 | 1 | HEADY (`heady`): **2** (1 exact / 1 artist) |
| 83 | Drugdealer | **2** | 0 | 2 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist)<br>Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 84 | Duran Duran | **2** | 0 | 2 | Yammat FM (`yammat-fm`): **2** (0 exact / 2 artist) |
| 85 | Empire Of The Sun | **2** | 0 | 2 | Yammat FM (`yammat-fm`): **2** (0 exact / 2 artist) |
| 86 | Everything Everything | **2** | 0 | 2 | Yammat FM (`yammat-fm`): **2** (0 exact / 2 artist) |
| 87 | Galaxie 500 | **2** | 1 | 1 | Super45.fm (`super45-fm`): **2** (1 exact / 1 artist) |
| 88 | GORILLAZ | **2** | 0 | 2 | Yammat FM (`yammat-fm`): **2** (0 exact / 2 artist) |
| 89 | KHRUANGBIN | **2** | 0 | 2 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist)<br>Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 90 | Men I Trust | **2** | 2 | 0 | HEADY (`heady`): **1** (1 exact / 0 artist)<br>Yammat FM (`yammat-fm`): **1** (1 exact / 0 artist) |
| 91 | MJ Lenderman | **2** | 0 | 2 | Yammat FM (`yammat-fm`): **2** (0 exact / 2 artist) |
| 92 | Mk.gee | **2** | 0 | 2 | HEADY (`heady`): **1** (0 exact / 1 artist)<br>Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 93 | Mulatu Astatke | **2** | 0 | 2 | Super45.fm (`super45-fm`): **2** (0 exact / 2 artist) |
| 94 | Nina Simone | **2** | 0 | 2 | Championshipvinyl (`championshipvinyl`): **1** (0 exact / 1 artist)<br>Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 95 | Phil Collins | **2** | 0 | 2 | Yammat FM (`yammat-fm`): **2** (0 exact / 2 artist) |
| 96 | Protomartyr | **2** | 0 | 2 | HEADY (`heady`): **1** (0 exact / 1 artist)<br>Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 97 | Rollins Band | **2** | 0 | 2 | Path through the Forest (`path-through-the-forest`): **2** (0 exact / 2 artist) |
| 98 | Roy Orbison | **2** | 0 | 2 | Path through the Forest (`path-through-the-forest`): **2** (0 exact / 2 artist) |
| 99 | Sleep | **2** | 0 | 2 | Path through the Forest (`path-through-the-forest`): **2** (0 exact / 2 artist) |
| 100 | Smashing Pumpkins | **2** | 0 | 2 | HEADY (`heady`): **2** (0 exact / 2 artist) |
| 101 | Steely Dan | **2** | 2 | 0 | Yammat FM (`yammat-fm`): **2** (2 exact / 0 artist) |
| 102 | The Cranberries | **2** | 0 | 2 | Yammat FM (`yammat-fm`): **2** (0 exact / 2 artist) |
| 103 | The Lazy Eyes | **2** | 1 | 1 | HEADY (`heady`): **2** (1 exact / 1 artist) |
| 104 | Tom Tom Club | **2** | 2 | 0 | Super45.fm (`super45-fm`): **1** (1 exact / 0 artist)<br>Yammat FM (`yammat-fm`): **1** (1 exact / 0 artist) |
| 105 | All Them Witches | **1** | 0 | 1 | Path through the Forest (`path-through-the-forest`): **1** (0 exact / 1 artist) |
| 106 | Arc De Soleil | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 107 | Bakar | **1** | 1 | 0 | Yammat FM (`yammat-fm`): **1** (1 exact / 0 artist) |
| 108 | Bananarama | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 109 | Black Moth Super Rainbow | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 110 | Bloc Party | **1** | 1 | 0 | HEADY (`heady`): **1** (1 exact / 0 artist) |
| 111 | Bronski Beat | **1** | 1 | 0 | Yammat FM (`yammat-fm`): **1** (1 exact / 0 artist) |
| 112 | Cannons | **1** | 1 | 0 | Yammat FM (`yammat-fm`): **1** (1 exact / 0 artist) |
| 113 | Catherine Wheel | **1** | 1 | 0 | Super45.fm (`super45-fm`): **1** (1 exact / 0 artist) |
| 114 | Connan Mockasin | **1** | 1 | 0 | Yammat FM (`yammat-fm`): **1** (1 exact / 0 artist) |
| 115 | Daryl Hall & John Oates | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 116 | Dehd | **1** | 1 | 0 | HEADY (`heady`): **1** (1 exact / 0 artist) |
| 117 | Don Henley | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 118 | Dry Cleaning | **1** | 1 | 0 | HEADY (`heady`): **1** (1 exact / 0 artist) |
| 119 | Fuzz | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 120 | Genesis | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 121 | Genesis Owusu | **1** | 1 | 0 | HEADY (`heady`): **1** (1 exact / 0 artist) |
| 122 | Grateful Dead | **1** | 0 | 1 | Path through the Forest (`path-through-the-forest`): **1** (0 exact / 1 artist) |
| 123 | John Maus | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 124 | King Gizzard & the Lizard Wizard | **1** | 1 | 0 | Yammat FM (`yammat-fm`): **1** (1 exact / 0 artist) |
| 125 | King Harvest | **1** | 1 | 0 | Yammat FM (`yammat-fm`): **1** (1 exact / 0 artist) |
| 126 | Kodomo | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 127 | KOKOROKO | **1** | 1 | 0 | Yammat FM (`yammat-fm`): **1** (1 exact / 0 artist) |
| 128 | LCD Soundsystem | **1** | 1 | 0 | HEADY (`heady`): **1** (1 exact / 0 artist) |
| 129 | Lo Moon | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 130 | Madlib | **1** | 1 | 0 | Yammat FM (`yammat-fm`): **1** (1 exact / 0 artist) |
| 131 | Manuel Göttsching | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 132 | Mark Morrison | **1** | 1 | 0 | Super45.fm (`super45-fm`): **1** (1 exact / 0 artist) |
| 133 | Maxwell | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 134 | Momma | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 135 | Moses Gunn Collective | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 136 | Nancy Sinatra | **1** | 1 | 0 | Super45.fm (`super45-fm`): **1** (1 exact / 0 artist) |
| 137 | Nathan Micay | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 138 | Neu! | **1** | 1 | 0 | Super45.fm (`super45-fm`): **1** (1 exact / 0 artist) |
| 139 | Orions Belte | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 140 | Patti Smith | **1** | 1 | 0 | Yammat FM (`yammat-fm`): **1** (1 exact / 0 artist) |
| 141 | Paul Westerberg | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 142 | Pearl Jam | **1** | 1 | 0 | Yammat FM (`yammat-fm`): **1** (1 exact / 0 artist) |
| 143 | Pile | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 144 | Pixies | **1** | 1 | 0 | Yammat FM (`yammat-fm`): **1** (1 exact / 0 artist) |
| 145 | Plone | **1** | 1 | 0 | Super45.fm (`super45-fm`): **1** (1 exact / 0 artist) |
| 146 | Police | **1** | 1 | 0 | Yammat FM (`yammat-fm`): **1** (1 exact / 0 artist) |
| 147 | Public Image LTD. | **1** | 1 | 0 | Super45.fm (`super45-fm`): **1** (1 exact / 0 artist) |
| 148 | Pye Corner Audio | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 149 | RED HOT CHILI PEPPERS | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 150 | Robbie Robertson | **1** | 1 | 0 | Yammat FM (`yammat-fm`): **1** (1 exact / 0 artist) |
| 151 | Robert Palmer | **1** | 1 | 0 | Super45.fm (`super45-fm`): **1** (1 exact / 0 artist) |
| 152 | ROSALÍA | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 153 | Shuggie Otis | **1** | 1 | 0 | HEADY (`heady`): **1** (1 exact / 0 artist) |
| 154 | Silver Apples | **1** | 1 | 0 | Super45.fm (`super45-fm`): **1** (1 exact / 0 artist) |
| 155 | Sisters of Mercy | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 156 | Surprise Chef | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 157 | TEMPLES | **1** | 1 | 0 | Super45.fm (`super45-fm`): **1** (1 exact / 0 artist) |
| 158 | The Band | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 159 | THE BEATLES | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 160 | The Black Angels | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 161 | The Brian Jonestown Massacre | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 162 | The Budos Band | **1** | 1 | 0 | HEADY (`heady`): **1** (1 exact / 0 artist) |
| 163 | The Cars | **1** | 0 | 1 | Yammat FM (`yammat-fm`): **1** (0 exact / 1 artist) |
| 164 | The Police | **1** | 1 | 0 | Yammat FM (`yammat-fm`): **1** (1 exact / 0 artist) |
| 165 | The Righteous Brothers | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 166 | THE SMITHS | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 167 | The War on Drugs | **1** | 1 | 0 | Yammat FM (`yammat-fm`): **1** (1 exact / 0 artist) |
| 168 | This Will Destroy You | **1** | 0 | 1 | Championshipvinyl (`championshipvinyl`): **1** (0 exact / 1 artist) |
| 169 | Thundercat | **1** | 1 | 0 | HEADY (`heady`): **1** (1 exact / 0 artist) |
| 170 | Tony Allen | **1** | 0 | 1 | Super45.fm (`super45-fm`): **1** (0 exact / 1 artist) |
| 171 | Tortoise | **1** | 1 | 0 | Super45.fm (`super45-fm`): **1** (1 exact / 0 artist) |
| 172 | Ty Segall | **1** | 1 | 0 | HEADY (`heady`): **1** (1 exact / 0 artist) |
| 173 | Vundabar | **1** | 1 | 0 | HEADY (`heady`): **1** (1 exact / 0 artist) |
| 174 | Wavves | **1** | 1 | 0 | HEADY (`heady`): **1** (1 exact / 0 artist) |
| 175 | Will Van Horn | **1** | 1 | 0 | HEADY (`heady`): **1** (1 exact / 0 artist) |
| 176 | Wine Lips | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |
| 177 | Yeah Yeah Yeahs | **1** | 1 | 0 | HEADY (`heady`): **1** (1 exact / 0 artist) |
| 178 | Yin Yin | **1** | 0 | 1 | HEADY (`heady`): **1** (0 exact / 1 artist) |

## Discovery

| Rank | Artist | Total | Exact | Artist-level | Contributing stations |
|---:|---|---:|---:|---:|---|
| 1 | The Beatles | **412** | 34 | 378 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **291** (33 exact / 258 artist)<br>Radio SAR - Studencka Agencja Radiowa (`radio-sar-studencka-agencja-radiowa`): **36** (0 exact / 36 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **18** (0 exact / 18 artist)<br>Nostalgie New York (`nostalgie-new-york`): **16** (0 exact / 16 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **13** (0 exact / 13 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **10** (0 exact / 10 artist)<br>RadioActive (`radioactive`): **6** (0 exact / 6 artist)<br>WSUM 91.7 FM (`wsum`): **4** (0 exact / 4 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **3** (0 exact / 3 artist)<br>KFAI 90.3 FM (`kfai`): **3** (0 exact / 3 artist)<br>WORT 89.9 FM (`wort`): **3** (0 exact / 3 artist)<br>Radio FM (`radio-fm`): **2** (0 exact / 2 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **2** (0 exact / 2 artist)<br>KZSC 88.1 FM (`kzsc`): **1** (1 exact / 0 artist)<br>Rovinj FM (`rovinj-fm`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist)<br>WCBN 88.3 FM (`wcbn`): **1** (0 exact / 1 artist)<br>WEFT 90.1 FM (`weft`): **1** (0 exact / 1 artist) |
| 2 | Depeche Mode | **402** | 21 | 381 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **198** (4 exact / 194 artist)<br>Synthradio (`synthradio`): **129** (6 exact / 123 artist)<br>Big R Radio - The Wave (`big-r-radio-the-wave`): **18** (1 exact / 17 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **8** (1 exact / 7 artist)<br>PANORAMA80 (`panorama80`): **8** (0 exact / 8 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **4** (1 exact / 3 artist)<br>Radio Armisa (`radio-armisa`): **4** (1 exact / 3 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **3** (1 exact / 2 artist)<br>Nostalgie New York (`nostalgie-new-york`): **3** (1 exact / 2 artist)<br>Radio Mela (`radio-mela`): **3** (1 exact / 2 artist)<br>Sfliny Alternative 80's (`sfliny-alternative-80-s`): **3** (0 exact / 3 artist)<br>WSUM 91.7 FM (`wsum`): **3** (0 exact / 3 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **3** (1 exact / 2 artist)<br>Radio FM (`radio-fm`): **2** (0 exact / 2 artist)<br>RadioActive (`radioactive`): **2** (1 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **2** (1 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **2** (0 exact / 2 artist)<br>WLUR 91.5 FM (`wlur`): **2** (1 exact / 1 artist)<br>XWave Radio (`xwave-radio`): **2** (0 exact / 2 artist)<br>KAOS 89.3 FM (`kaos`): **1** (0 exact / 1 artist)<br>KZSC 88.1 FM (`kzsc`): **1** (0 exact / 1 artist)<br>Rockserwis.fm (`rockserwis-fm`): **1** (0 exact / 1 artist) |
| 3 | David Bowie | **299** | 27 | 272 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **228** (22 exact / 206 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **13** (1 exact / 12 artist)<br>Big R Radio - The Wave (`big-r-radio-the-wave`): **7** (1 exact / 6 artist)<br>RadioActive (`radioactive`): **6** (0 exact / 6 artist)<br>Synthradio (`synthradio`): **5** (0 exact / 5 artist)<br>WSUM 91.7 FM (`wsum`): **5** (0 exact / 5 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **4** (0 exact / 4 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **4** (1 exact / 3 artist)<br>KZSC 88.1 FM (`kzsc`): **3** (0 exact / 3 artist)<br>KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **2** (0 exact / 2 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **2** (0 exact / 2 artist)<br>Nostalgie New York (`nostalgie-new-york`): **2** (0 exact / 2 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **2** (0 exact / 2 artist)<br>Radio Armisa (`radio-armisa`): **2** (0 exact / 2 artist)<br>Radio Mela (`radio-mela`): **2** (0 exact / 2 artist)<br>Radio SAR - Studencka Agencja Radiowa (`radio-sar-studencka-agencja-radiowa`): **2** (0 exact / 2 artist)<br>Rovinj FM (`rovinj-fm`): **2** (0 exact / 2 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **2** (2 exact / 0 artist)<br>Dare-FM (`dare-fm`): **1** (0 exact / 1 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Pro-Radio (`pro-radio`): **1** (0 exact / 1 artist)<br>RMC Voyage Voyage (`rmc-voyage-voyage`): **1** (0 exact / 1 artist)<br>Sfliny Alternative 80's (`sfliny-alternative-80-s`): **1** (0 exact / 1 artist) |
| 4 | Prince | **294** | 2 | 292 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **250** (1 exact / 249 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **6** (0 exact / 6 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **5** (1 exact / 4 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **4** (0 exact / 4 artist)<br>RadioActive (`radioactive`): **4** (0 exact / 4 artist)<br>Radio Mela (`radio-mela`): **3** (0 exact / 3 artist)<br>Traxx FM - Cool Jam (`traxx-fm-cool-jam`): **3** (0 exact / 3 artist)<br>WBEZ-HD2 "Vocalo Stream" Chicago, IL (`wbez-hd2-vocalo-stream-chicago-il`): **3** (0 exact / 3 artist)<br>Nostalgie New York (`nostalgie-new-york`): **2** (0 exact / 2 artist)<br>WORT 89.9 FM (`wort`): **2** (0 exact / 2 artist)<br>KFAI 90.3 FM (`kfai`): **1** (0 exact / 1 artist)<br>KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>RMC Nights Story (`rmc-nights-story`): **1** (0 exact / 1 artist)<br>RMC Voyage Voyage (`rmc-voyage-voyage`): **1** (0 exact / 1 artist)<br>Rovinj FM (`rovinj-fm`): **1** (0 exact / 1 artist)<br>Sfliny Alternative 80's (`sfliny-alternative-80-s`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist)<br>WEFT 90.1 FM (`weft`): **1** (0 exact / 1 artist)<br>WLUR 91.5 FM (`wlur`): **1** (0 exact / 1 artist)<br>WSUM 91.7 FM (`wsum`): **1** (0 exact / 1 artist) |
| 5 | The Cure | **293** | 2 | 291 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **244** (2 exact / 242 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **11** (0 exact / 11 artist)<br>KZSC 88.1 FM (`kzsc`): **5** (0 exact / 5 artist)<br>6forty Radio (`6forty-radio`): **4** (0 exact / 4 artist)<br>Big R Radio - The Wave (`big-r-radio-the-wave`): **4** (0 exact / 4 artist)<br>DKFM Classic (`dkfm-classic`): **4** (0 exact / 4 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **3** (0 exact / 3 artist)<br>WLUR 91.5 FM (`wlur`): **3** (0 exact / 3 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **2** (0 exact / 2 artist)<br>Radio FM (`radio-fm`): **2** (0 exact / 2 artist)<br>WSUM 91.7 FM (`wsum`): **2** (0 exact / 2 artist)<br>KFAI 90.3 FM (`kfai`): **1** (0 exact / 1 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (0 exact / 1 artist)<br>Radio Armisa (`radio-armisa`): **1** (0 exact / 1 artist)<br>Radio Mela (`radio-mela`): **1** (0 exact / 1 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>Sfliny Alternative 80's (`sfliny-alternative-80-s`): **1** (0 exact / 1 artist)<br>WORT 89.9 FM (`wort`): **1** (0 exact / 1 artist)<br>WRIR 97.3 FM (`wrir`): **1** (0 exact / 1 artist)<br>XWave Radio (`xwave-radio`): **1** (0 exact / 1 artist) |
| 6 | Nina Simone | **211** | 1 | 210 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **188** (1 exact / 187 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **3** (0 exact / 3 artist)<br>RadioActive (`radioactive`): **3** (0 exact / 3 artist)<br>SWISS GROOVE (`swiss-groove`): **3** (0 exact / 3 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **2** (0 exact / 2 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **2** (0 exact / 2 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **2** (0 exact / 2 artist)<br>C Lab (`c-lab`): **1** (0 exact / 1 artist)<br>Grolloo Radio (`grolloo-radio`): **1** (0 exact / 1 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist)<br>open broadcast radio (`open-broadcast-radio`): **1** (0 exact / 1 artist)<br>Rovinj FM (`rovinj-fm`): **1** (0 exact / 1 artist)<br>Test ArtistMetadataCleanup e5043e15 (`test-amc-e5043e15`): **1** (0 exact / 1 artist)<br>WRBB 104.9 FM (`wrbb`): **1** (0 exact / 1 artist)<br>WSUM 91.7 FM (`wsum`): **1** (0 exact / 1 artist) |
| 7 | Marvin Gaye | **202** | 1 | 201 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **171** (1 exact / 170 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **4** (0 exact / 4 artist)<br>Nostalgie New York (`nostalgie-new-york`): **3** (0 exact / 3 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **2** (0 exact / 2 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **2** (0 exact / 2 artist)<br>WEFT 90.1 FM (`weft`): **2** (0 exact / 2 artist)<br>WLUR 91.5 FM (`wlur`): **2** (0 exact / 2 artist)<br>Art Of Music (`art-of-music`): **1** (0 exact / 1 artist)<br>C Lab (`c-lab`): **1** (0 exact / 1 artist)<br>JAMM FM (`jamm-fm`): **1** (0 exact / 1 artist)<br>Jazzloft (`jazzloft`): **1** (0 exact / 1 artist)<br>KCSB 91.9 FM (`kcsb`): **1** (0 exact / 1 artist)<br>KZSC 88.1 FM (`kzsc`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist)<br>Radio Mela (`radio-mela`): **1** (0 exact / 1 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist)<br>Traxx FM - Cool Jam (`traxx-fm-cool-jam`): **1** (0 exact / 1 artist)<br>WRIR 97.3 FM (`wrir`): **1** (0 exact / 1 artist)<br>WSUM 91.7 FM (`wsum`): **1** (0 exact / 1 artist)<br>WUML 91.5 FM (`wuml`): **1** (0 exact / 1 artist) |
| 8 | Nirvana | **188** | 0 | 188 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **158** (0 exact / 158 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **10** (0 exact / 10 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **6** (0 exact / 6 artist)<br>Nostalgie New York (`nostalgie-new-york`): **3** (0 exact / 3 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **2** (0 exact / 2 artist)<br>WRBB 104.9 FM (`wrbb`): **2** (0 exact / 2 artist)<br>KAOS 89.3 FM (`kaos`): **1** (0 exact / 1 artist)<br>KTUH 90.3 FM (`ktuh`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Radio Underground (`radio-underground`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>WEFT 90.1 FM (`weft`): **1** (0 exact / 1 artist)<br>WLUR 91.5 FM (`wlur`): **1** (0 exact / 1 artist) |
| 9 | Talking Heads | **176** | 0 | 176 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **133** (0 exact / 133 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **12** (0 exact / 12 artist)<br>Big R Radio - The Wave (`big-r-radio-the-wave`): **8** (0 exact / 8 artist)<br>Nostalgie New York (`nostalgie-new-york`): **4** (0 exact / 4 artist)<br>WSUM 91.7 FM (`wsum`): **3** (0 exact / 3 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **2** (0 exact / 2 artist)<br>KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **2** (0 exact / 2 artist)<br>KZSC 88.1 FM (`kzsc`): **2** (0 exact / 2 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **2** (0 exact / 2 artist)<br>Dare-FM (`dare-fm`): **1** (0 exact / 1 artist)<br>KFAI 90.3 FM (`kfai`): **1** (0 exact / 1 artist)<br>KTUH 90.3 FM (`ktuh`): **1** (0 exact / 1 artist)<br>Radio FM (`radio-fm`): **1** (0 exact / 1 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>Rovinj FM (`rovinj-fm`): **1** (0 exact / 1 artist)<br>WCBN 88.3 FM (`wcbn`): **1** (0 exact / 1 artist)<br>WLUR 91.5 FM (`wlur`): **1** (0 exact / 1 artist) |
| 10 | Grateful Dead | **168** | 1 | 167 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **151** (1 exact / 150 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **9** (0 exact / 9 artist)<br>KDUR 91.9 FM (`kdur`): **3** (0 exact / 3 artist)<br>East Tennessee's Own WDVX 89.9 FM (`east-tennessee-s-own-wdvx-89-9-fm`): **1** (0 exact / 1 artist)<br>Grolloo Radio (`grolloo-radio`): **1** (0 exact / 1 artist)<br>KAOS 89.3 FM (`kaos`): **1** (0 exact / 1 artist)<br>WLUR 91.5 FM (`wlur`): **1** (0 exact / 1 artist)<br>WPKN 89.5 FM (`wpkn`): **1** (0 exact / 1 artist) |
| 11 | R.E.M. | **168** | 0 | 168 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **137** (0 exact / 137 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **10** (0 exact / 10 artist)<br>Nostalgie New York (`nostalgie-new-york`): **3** (0 exact / 3 artist)<br>Big R Radio - The Wave (`big-r-radio-the-wave`): **2** (0 exact / 2 artist)<br>KTUH 90.3 FM (`ktuh`): **2** (0 exact / 2 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **2** (0 exact / 2 artist)<br>Rovinj FM (`rovinj-fm`): **2** (0 exact / 2 artist)<br>East Tennessee's Own WDVX 89.9 FM (`east-tennessee-s-own-wdvx-89-9-fm`): **1** (0 exact / 1 artist)<br>KDUR 91.9 FM (`kdur`): **1** (0 exact / 1 artist)<br>KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (0 exact / 1 artist)<br>Radio Mela (`radio-mela`): **1** (0 exact / 1 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>Sfliny Alternative 80's (`sfliny-alternative-80-s`): **1** (0 exact / 1 artist)<br>WLUR 91.5 FM (`wlur`): **1** (0 exact / 1 artist)<br>WSUM 91.7 FM (`wsum`): **1** (0 exact / 1 artist) |
| 12 | Dolly Parton | **166** | 10 | 156 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **128** (1 exact / 127 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **10** (0 exact / 10 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **4** (1 exact / 3 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **3** (1 exact / 2 artist)<br>Radio FM (`radio-fm`): **3** (1 exact / 2 artist)<br>aNONradio (`anonradio`): **1** (1 exact / 0 artist)<br>East Tennessee's Own WDVX 89.9 FM (`east-tennessee-s-own-wdvx-89-9-fm`): **1** (0 exact / 1 artist)<br>Grolloo Radio (`grolloo-radio`): **1** (0 exact / 1 artist)<br>KAOS 89.3 FM (`kaos`): **1** (0 exact / 1 artist)<br>KZSC 88.1 FM (`kzsc`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (1 exact / 0 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (1 exact / 0 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (1 exact / 0 artist)<br>Radio Armisa (`radio-armisa`): **1** (1 exact / 0 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>SomaFM ThistleRadio (128k AAC) (`somafm-thistleradio-128k-aac`): **1** (0 exact / 1 artist)<br>SomaFM ThistleRadio (128k MP3) (`somafm-thistleradio-128k-mp3`): **1** (0 exact / 1 artist)<br>SRF Musikwelle (`srf-musikwelle`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist)<br>Tukker FM (`tukker-fm`): **1** (0 exact / 1 artist)<br>WEFT 90.1 FM (`weft`): **1** (0 exact / 1 artist)<br>WLUR 91.5 FM (`wlur`): **1** (1 exact / 0 artist)<br>WUMB (`wumb`): **1** (0 exact / 1 artist) |
| 13 | Bob Marley & The Wailers | **156** | 7 | 149 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **154** (5 exact / 149 artist)<br>KTUH 90.3 FM (`ktuh`): **1** (1 exact / 0 artist)<br>WLUR 91.5 FM (`wlur`): **1** (1 exact / 0 artist) |
| 14 | Pink Floyd | **148** | 27 | 121 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **106** (12 exact / 94 artist)<br>Nostalgie New York (`nostalgie-new-york`): **10** (2 exact / 8 artist)<br>Radio SAR - Studencka Agencja Radiowa (`radio-sar-studencka-agencja-radiowa`): **8** (7 exact / 1 artist)<br>Heavy Music Atmospheric Radio (`heavy-music-atmospheric-radio`): **6** (2 exact / 4 artist)<br>RadioActive (`radioactive`): **3** (0 exact / 3 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **2** (0 exact / 2 artist)<br>WRBB 104.9 FM (`wrbb`): **2** (1 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **2** (1 exact / 1 artist)<br>KDUR 91.9 FM (`kdur`): **1** (0 exact / 1 artist)<br>KTUH 90.3 FM (`ktuh`): **1** (0 exact / 1 artist)<br>KZSC 88.1 FM (`kzsc`): **1** (0 exact / 1 artist)<br>Radio FM (`radio-fm`): **1** (0 exact / 1 artist)<br>Radio Mela (`radio-mela`): **1** (1 exact / 0 artist)<br>Rovinj FM (`rovinj-fm`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist)<br>Virgin Radio Rockstar: Pink Floyd (`virgin-radio-rockstar-pink-floyd`): **1** (0 exact / 1 artist)<br>WSUM 91.7 FM (`wsum`): **1** (1 exact / 0 artist) |
| 15 | Queen | **137** | 0 | 137 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **60** (0 exact / 60 artist)<br>Radio SAR - Studencka Agencja Radiowa (`radio-sar-studencka-agencja-radiowa`): **19** (0 exact / 19 artist)<br>Nostalgie New York (`nostalgie-new-york`): **11** (0 exact / 11 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **8** (0 exact / 8 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **8** (0 exact / 8 artist)<br>Pro-Radio (`pro-radio`): **7** (0 exact / 7 artist)<br>WLUR 91.5 FM (`wlur`): **6** (0 exact / 6 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **5** (0 exact / 5 artist)<br>Synthradio (`synthradio`): **3** (0 exact / 3 artist)<br>Rovinj FM (`rovinj-fm`): **2** (0 exact / 2 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **2** (0 exact / 2 artist)<br>Lele Male (`lele-male`): **1** (0 exact / 1 artist)<br>Radio Mela (`radio-mela`): **1** (0 exact / 1 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>Tukker FM (`tukker-fm`): **1** (0 exact / 1 artist)<br>WKNC 88.1 FM (`wknc`): **1** (0 exact / 1 artist)<br>WTBU 89.3 FM (`wtbu`): **1** (0 exact / 1 artist) |
| 16 | Kraftwerk | **130** | 0 | 130 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **110** (0 exact / 110 artist)<br>PANORAMA80 (`panorama80`): **7** (0 exact / 7 artist)<br>Radio Caprice - Krautrock (`radio-caprice-krautrock`): **4** (0 exact / 4 artist)<br>XWave Radio (`xwave-radio`): **3** (0 exact / 3 artist)<br>Synthradio (`synthradio`): **2** (0 exact / 2 artist)<br>Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (0 exact / 1 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist)<br>WSUM 91.7 FM (`wsum`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 17 | Duran Duran | **126** | 0 | 126 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **69** (0 exact / 69 artist)<br>Big R Radio - The Wave (`big-r-radio-the-wave`): **16** (0 exact / 16 artist)<br>Radio Mela (`radio-mela`): **7** (0 exact / 7 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **6** (0 exact / 6 artist)<br>PANORAMA80 (`panorama80`): **3** (0 exact / 3 artist)<br>RadioActive (`radioactive`): **3** (0 exact / 3 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **3** (0 exact / 3 artist)<br>KTUH 90.3 FM (`ktuh`): **2** (0 exact / 2 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **2** (0 exact / 2 artist)<br>Sfliny Alternative 80's (`sfliny-alternative-80-s`): **2** (0 exact / 2 artist)<br>Synthradio (`synthradio`): **2** (0 exact / 2 artist)<br>Dare-FM (`dare-fm`): **1** (0 exact / 1 artist)<br>Experimental/Avant-garde music - Radio Caprice (`experimental-avant-garde-music-radio-caprice`): **1** (0 exact / 1 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist)<br>KCSB 91.9 FM (`kcsb`): **1** (0 exact / 1 artist)<br>KFAI 90.3 FM (`kfai`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist)<br>Pro-Radio (`pro-radio`): **1** (0 exact / 1 artist)<br>WCBN 88.3 FM (`wcbn`): **1** (0 exact / 1 artist)<br>WLUR 91.5 FM (`wlur`): **1** (0 exact / 1 artist) |
| 18 | Neil Young | **119** | 0 | 119 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **92** (0 exact / 92 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **9** (0 exact / 9 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **2** (0 exact / 2 artist)<br>KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **2** (0 exact / 2 artist)<br>KTUH 90.3 FM (`ktuh`): **2** (0 exact / 2 artist)<br>KZSC 88.1 FM (`kzsc`): **2** (0 exact / 2 artist)<br>Nostalgie New York (`nostalgie-new-york`): **2** (0 exact / 2 artist)<br>RadioActive (`radioactive`): **2** (0 exact / 2 artist)<br>WDCE 90.1 FM (`wdce`): **2** (0 exact / 2 artist)<br>WRBB 104.9 FM (`wrbb`): **2** (0 exact / 2 artist)<br>KDUR 91.9 FM (`kdur`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 19 | Björk | **117** | 0 | 117 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **105** (0 exact / 105 artist)<br>Experimental/Avant-garde music - Radio Caprice (`experimental-avant-garde-music-radio-caprice`): **4** (0 exact / 4 artist)<br>RMC Nights Story (`rmc-nights-story`): **2** (0 exact / 2 artist)<br>WRBB 104.9 FM (`wrbb`): **2** (0 exact / 2 artist)<br>WSUM 91.7 FM (`wsum`): **2** (0 exact / 2 artist)<br>KZSC 88.1 FM (`kzsc`): **1** (0 exact / 1 artist)<br>WUML 91.5 FM (`wuml`): **1** (0 exact / 1 artist) |
| 20 | Fleetwood Mac | **116** | 0 | 116 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **78** (0 exact / 78 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **8** (0 exact / 8 artist)<br>WLUR 91.5 FM (`wlur`): **8** (0 exact / 8 artist)<br>Nostalgie New York (`nostalgie-new-york`): **6** (0 exact / 6 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **4** (0 exact / 4 artist)<br>KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **3** (0 exact / 3 artist)<br>WRBB 104.9 FM (`wrbb`): **3** (0 exact / 3 artist)<br>KFAI 90.3 FM (`kfai`): **2** (0 exact / 2 artist)<br>RadioActive (`radioactive`): **2** (0 exact / 2 artist)<br>Radio Armisa (`radio-armisa`): **1** (0 exact / 1 artist)<br>Radio Mela (`radio-mela`): **1** (0 exact / 1 artist) |
| 21 | Jimi Hendrix | **107** | 0 | 107 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **93** (0 exact / 93 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **4** (0 exact / 4 artist)<br>KTUH 90.3 FM (`ktuh`): **2** (0 exact / 2 artist)<br>KZSC 88.1 FM (`kzsc`): **2** (0 exact / 2 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **2** (0 exact / 2 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>WRBB 104.9 FM (`wrbb`): **1** (0 exact / 1 artist) |
| 22 | Kate Bush | **104** | 8 | 96 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **94** (3 exact / 91 artist)<br>KZSC 88.1 FM (`kzsc`): **2** (0 exact / 2 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **2** (2 exact / 0 artist)<br>Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (0 exact / 1 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (1 exact / 0 artist)<br>RadioActive (`radioactive`): **1** (1 exact / 0 artist)<br>WEFT 90.1 FM (`weft`): **1** (0 exact / 1 artist)<br>WLUR 91.5 FM (`wlur`): **1** (1 exact / 0 artist) |
| 23 | Nine Inch Nails | **104** | 1 | 103 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **92** (1 exact / 91 artist)<br>Synthradio (`synthradio`): **5** (0 exact / 5 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **3** (0 exact / 3 artist)<br>dinamo.fm smog (`dinamo-fm-smog`): **1** (0 exact / 1 artist)<br>Heavy Music Atmospheric Radio (`heavy-music-atmospheric-radio`): **1** (0 exact / 1 artist)<br>WRIR 97.3 FM (`wrir`): **1** (0 exact / 1 artist)<br>WSUM 91.7 FM (`wsum`): **1** (0 exact / 1 artist) |
| 24 | King Gizzard & The Lizard Wizard | **103** | 1 | 102 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **101** (1 exact / 100 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 25 | Modest Mouse | **99** | 2 | 97 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **84** (2 exact / 82 artist)<br>WSUM 91.7 FM (`wsum`): **3** (0 exact / 3 artist)<br>KAOS 89.3 FM (`kaos`): **2** (0 exact / 2 artist)<br>WCFM 91.9 FM (`wcfm`): **2** (0 exact / 2 artist)<br>WLUR 91.5 FM (`wlur`): **2** (0 exact / 2 artist)<br>WRBB 104.9 FM (`wrbb`): **2** (0 exact / 2 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **2** (0 exact / 2 artist)<br>KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>KZSC 88.1 FM (`kzsc`): **1** (0 exact / 1 artist) |
| 26 | The Beach Boys | **98** | 0 | 98 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **86** (0 exact / 86 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **3** (0 exact / 3 artist)<br>Nostalgie New York (`nostalgie-new-york`): **2** (0 exact / 2 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **2** (0 exact / 2 artist)<br>WCBN 88.3 FM (`wcbn`): **2** (0 exact / 2 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>Traxx FM - Cool Jam (`traxx-fm-cool-jam`): **1** (0 exact / 1 artist) |
| 27 | Thievery Corporation | **97** | 3 | 94 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **57** (1 exact / 56 artist)<br>Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **9** (0 exact / 9 artist)<br>Radio Paradise World/ETC Mix 192k MP3 (`radio-paradise-world-etc-mix-192k-mp3`): **9** (0 exact / 9 artist)<br>Radio Paradise World/Etc Mix 320k AAC (`radio-paradise-world-etc-mix-320k-aac`): **9** (0 exact / 9 artist)<br>Hi On Line World Radio (`hi-on-line-world-radio`): **3** (0 exact / 3 artist)<br>RadioActive (`radioactive`): **3** (0 exact / 3 artist)<br>Jazzloft (`jazzloft`): **2** (0 exact / 2 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **2** (1 exact / 1 artist)<br>KDUR 91.9 FM (`kdur`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (1 exact / 0 artist)<br>SWISS GROOVE (`swiss-groove`): **1** (0 exact / 1 artist) |
| 28 | Black Sabbath | **95** | 7 | 88 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **87** (7 exact / 80 artist)<br>DJ 666 Geordieblackcore (`dj-666-geordieblackcore`): **2** (0 exact / 2 artist)<br>KAOS 89.3 FM (`kaos`): **1** (0 exact / 1 artist)<br>Radio FM (`radio-fm`): **1** (0 exact / 1 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>Rovinj FM (`rovinj-fm`): **1** (0 exact / 1 artist)<br>WCBN 88.3 FM (`wcbn`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 29 | The Replacements | **95** | 0 | 95 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **89** (0 exact / 89 artist)<br>KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **2** (0 exact / 2 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **2** (0 exact / 2 artist)<br>Sfliny Alternative 80's (`sfliny-alternative-80-s`): **1** (0 exact / 1 artist)<br>WSUM 91.7 FM (`wsum`): **1** (0 exact / 1 artist) |
| 30 | Underworld | **95** | 0 | 95 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **83** (0 exact / 83 artist)<br>SomaFM Black Rock FM (128k AAC Non-SSL) (`somafm-black-rock-fm-128k-aac-non-ssl`): **6** (0 exact / 6 artist)<br>dinamo.fm smog (`dinamo-fm-smog`): **1** (0 exact / 1 artist)<br>PANORAMA80 (`panorama80`): **1** (0 exact / 1 artist)<br>Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **1** (0 exact / 1 artist)<br>Radio Paradise World/ETC Mix 192k MP3 (`radio-paradise-world-etc-mix-192k-mp3`): **1** (0 exact / 1 artist)<br>Radio Paradise World/Etc Mix 320k AAC (`radio-paradise-world-etc-mix-320k-aac`): **1** (0 exact / 1 artist)<br>WCBN 88.3 FM (`wcbn`): **1** (0 exact / 1 artist) |
| 31 | Low | **92** | 0 | 92 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **83** (0 exact / 83 artist)<br>6forty Radio (`6forty-radio`): **6** (0 exact / 6 artist)<br>KDUR 91.9 FM (`kdur`): **1** (0 exact / 1 artist)<br>WDCE 90.1 FM (`wdce`): **1** (0 exact / 1 artist)<br>WRBB 104.9 FM (`wrbb`): **1** (0 exact / 1 artist) |
| 32 | Gong | **90** | 0 | 90 | Avant-Prog/Rock in Opposition/Canterbury Scene/Zeuhl - Radio Caprice (`avant-prog-rock-in-opposition-canterbury-scene-zeuhl-radio-caprice`): **76** (0 exact / 76 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **11** (0 exact / 11 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **2** (0 exact / 2 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist) |
| 33 | Sigur Rós | **88** | 0 | 88 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **53** (0 exact / 53 artist)<br>Radio Caprice - Post-rock (`radio-caprice-post-rock`): **25** (0 exact / 25 artist)<br>6forty Radio (`6forty-radio`): **3** (0 exact / 3 artist)<br>Heavy Music Atmospheric Radio (`heavy-music-atmospheric-radio`): **3** (0 exact / 3 artist)<br>KAOS 89.3 FM (`kaos`): **2** (0 exact / 2 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 34 | Khruangbin | **87** | 7 | 80 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **75** (6 exact / 69 artist)<br>WBEZ-HD2 "Vocalo Stream" Chicago, IL (`wbez-hd2-vocalo-stream-chicago-il`): **6** (1 exact / 5 artist)<br>C Lab (`c-lab`): **2** (0 exact / 2 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **2** (0 exact / 2 artist)<br>dinamo.fm smog (`dinamo-fm-smog`): **1** (0 exact / 1 artist)<br>WLUR 91.5 FM (`wlur`): **1** (0 exact / 1 artist) |
| 35 | Gorillaz | **84** | 0 | 84 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **73** (0 exact / 73 artist)<br>C Lab (`c-lab`): **2** (0 exact / 2 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **2** (0 exact / 2 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist)<br>i love radio - greatest hits (`i-love-radio-greatest-hits`): **1** (0 exact / 1 artist)<br>KAOS 89.3 FM (`kaos`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>open broadcast radio (`open-broadcast-radio`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 36 | Peter Gabriel | **79** | 2 | 77 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **55** (2 exact / 53 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **6** (0 exact / 6 artist)<br>Nostalgie New York (`nostalgie-new-york`): **3** (0 exact / 3 artist)<br>Radio FM (`radio-fm`): **3** (0 exact / 3 artist)<br>Sfliny Alternative 80's (`sfliny-alternative-80-s`): **2** (0 exact / 2 artist)<br>Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (0 exact / 1 artist)<br>Dare-FM (`dare-fm`): **1** (0 exact / 1 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>Pro-Radio (`pro-radio`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>RMC Nights Story (`rmc-nights-story`): **1** (0 exact / 1 artist)<br>RMC Voyage Voyage (`rmc-voyage-voyage`): **1** (0 exact / 1 artist)<br>Rovinj FM (`rovinj-fm`): **1** (0 exact / 1 artist) |
| 37 | Chaka Khan | **76** | 0 | 76 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **49** (0 exact / 49 artist)<br>JAMM FM (`jamm-fm`): **5** (0 exact / 5 artist)<br>RMC Nights Story (`rmc-nights-story`): **5** (0 exact / 5 artist)<br>Traxx FM - Cool Jam (`traxx-fm-cool-jam`): **4** (0 exact / 4 artist)<br>WBEZ-HD2 "Vocalo Stream" Chicago, IL (`wbez-hd2-vocalo-stream-chicago-il`): **3** (0 exact / 3 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **2** (0 exact / 2 artist)<br>Art Of Music (`art-of-music`): **1** (0 exact / 1 artist)<br>C Lab (`c-lab`): **1** (0 exact / 1 artist)<br>KFAI 90.3 FM (`kfai`): **1** (0 exact / 1 artist)<br>KTUH 90.3 FM (`ktuh`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>SWISS GROOVE (`swiss-groove`): **1** (0 exact / 1 artist) |
| 38 | Eurythmics | **73** | 0 | 73 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **40** (0 exact / 40 artist)<br>Big R Radio - The Wave (`big-r-radio-the-wave`): **7** (0 exact / 7 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **4** (0 exact / 4 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **4** (0 exact / 4 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **3** (0 exact / 3 artist)<br>RadioActive (`radioactive`): **3** (0 exact / 3 artist)<br>Radio Mela (`radio-mela`): **2** (0 exact / 2 artist)<br>WLUR 91.5 FM (`wlur`): **2** (0 exact / 2 artist)<br>Dare-FM (`dare-fm`): **1** (0 exact / 1 artist)<br>KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>KZSC 88.1 FM (`kzsc`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Sfliny Alternative 80's (`sfliny-alternative-80-s`): **1** (0 exact / 1 artist)<br>Synthradio (`synthradio`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist)<br>XWave Radio (`xwave-radio`): **1** (0 exact / 1 artist) |
| 39 | Dengue Fever | **71** | 7 | 64 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **39** (4 exact / 35 artist)<br>Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **10** (1 exact / 9 artist)<br>Radio Paradise World/ETC Mix 192k MP3 (`radio-paradise-world-etc-mix-192k-mp3`): **10** (1 exact / 9 artist)<br>Radio Paradise World/Etc Mix 320k AAC (`radio-paradise-world-etc-mix-320k-aac`): **10** (1 exact / 9 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 40 | Tears for Fears | **66** | 0 | 66 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **58** (0 exact / 58 artist)<br>Big R Radio - The Wave (`big-r-radio-the-wave`): **3** (0 exact / 3 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>Radio FM (`radio-fm`): **1** (0 exact / 1 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>WDCE 90.1 FM (`wdce`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 41 | Fela Kuti | **64** | 0 | 64 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **51** (0 exact / 51 artist)<br>Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **4** (0 exact / 4 artist)<br>Radio Paradise World/ETC Mix 192k MP3 (`radio-paradise-world-etc-mix-192k-mp3`): **4** (0 exact / 4 artist)<br>Radio Paradise World/Etc Mix 320k AAC (`radio-paradise-world-etc-mix-320k-aac`): **4** (0 exact / 4 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist) |
| 42 | The Smiths | **64** | 33 | 31 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **54** (32 exact / 22 artist)<br>Big R Radio - The Wave (`big-r-radio-the-wave`): **4** (0 exact / 4 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **3** (0 exact / 3 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (1 exact / 0 artist)<br>Radio FM (`radio-fm`): **1** (0 exact / 1 artist)<br>WSUM 91.7 FM (`wsum`): **1** (0 exact / 1 artist) |
| 43 | T. Rex | **60** | 6 | 54 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **56** (6 exact / 50 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 44 | The Cars | **60** | 0 | 60 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **42** (0 exact / 42 artist)<br>Sfliny Alternative 80's (`sfliny-alternative-80-s`): **6** (0 exact / 6 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **4** (0 exact / 4 artist)<br>Big R Radio - The Wave (`big-r-radio-the-wave`): **2** (0 exact / 2 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist)<br>Radio Mela (`radio-mela`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>WLUR 91.5 FM (`wlur`): **1** (0 exact / 1 artist) |
| 45 | Ween | **59** | 0 | 59 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **54** (0 exact / 54 artist)<br>WDCE 90.1 FM (`wdce`): **2** (0 exact / 2 artist)<br>WRIR 97.3 FM (`wrir`): **1** (0 exact / 1 artist)<br>WSUM 91.7 FM (`wsum`): **1** (0 exact / 1 artist)<br>WUML 91.5 FM (`wuml`): **1** (0 exact / 1 artist) |
| 46 | The The | **57** | 2 | 55 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **46** (1 exact / 45 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **2** (0 exact / 2 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **2** (0 exact / 2 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **2** (0 exact / 2 artist)<br>Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (0 exact / 1 artist)<br>Radio FM (`radio-fm`): **1** (1 exact / 0 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>Sfliny Alternative 80's (`sfliny-alternative-80-s`): **1** (0 exact / 1 artist)<br>WSUM 91.7 FM (`wsum`): **1** (0 exact / 1 artist) |
| 47 | King Gizzard & the Lizard Wizard | **53** | 3 | 50 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **49** (3 exact / 46 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **3** (0 exact / 3 artist)<br>WDCE 90.1 FM (`wdce`): **1** (0 exact / 1 artist) |
| 48 | Bauhaus | **52** | 0 | 52 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **39** (0 exact / 39 artist)<br>XWave Radio (`xwave-radio`): **8** (0 exact / 8 artist)<br>KZSC 88.1 FM (`kzsc`): **2** (0 exact / 2 artist)<br>Sfliny Alternative 80's (`sfliny-alternative-80-s`): **2** (0 exact / 2 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist) |
| 49 | Foo Fighters | **52** | 0 | 52 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **34** (0 exact / 34 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **10** (0 exact / 10 artist)<br>KZSC 88.1 FM (`kzsc`): **3** (0 exact / 3 artist)<br>KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>Radio Armisa (`radio-armisa`): **1** (0 exact / 1 artist)<br>Rovinj FM (`rovinj-fm`): **1** (0 exact / 1 artist)<br>WLUR 91.5 FM (`wlur`): **1** (0 exact / 1 artist)<br>WSUM 91.7 FM (`wsum`): **1** (0 exact / 1 artist) |
| 50 | La Luz | **52** | 3 | 49 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **48** (2 exact / 46 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist)<br>KDUR 91.9 FM (`kdur`): **1** (0 exact / 1 artist)<br>KTUH 90.3 FM (`ktuh`): **1** (0 exact / 1 artist)<br>WUML 91.5 FM (`wuml`): **1** (1 exact / 0 artist) |
| 51 | MGMT | **52** | 3 | 49 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **38** (1 exact / 37 artist)<br>KZSC 88.1 FM (`kzsc`): **3** (0 exact / 3 artist)<br>C Lab (`c-lab`): **2** (1 exact / 1 artist)<br>i love radio - greatest hits (`i-love-radio-greatest-hits`): **2** (0 exact / 2 artist)<br>WLUR 91.5 FM (`wlur`): **2** (1 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **2** (0 exact / 2 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist)<br>Radio Armisa (`radio-armisa`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist) |
| 52 | Judas Priest | **51** | 0 | 51 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **49** (0 exact / 49 artist)<br>WUML 91.5 FM (`wuml`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 53 | The Brian Jonestown Massacre | **50** | 0 | 50 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **46** (0 exact / 46 artist)<br>DKFM Classic (`dkfm-classic`): **3** (0 exact / 3 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 54 | Galaxie 500 | **49** | 4 | 45 | DKFM Classic (`dkfm-classic`): **22** (2 exact / 20 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **22** (1 exact / 21 artist)<br>WRBB 104.9 FM (`wrbb`): **3** (1 exact / 2 artist)<br>WCFM 91.9 FM (`wcfm`): **1** (0 exact / 1 artist)<br>WORT 89.9 FM (`wort`): **1** (0 exact / 1 artist) |
| 55 | Paul McCartney | **49** | 0 | 49 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **31** (0 exact / 31 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **3** (0 exact / 3 artist)<br>Radio Mela (`radio-mela`): **3** (0 exact / 3 artist)<br>RadioActive (`radioactive`): **3** (0 exact / 3 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **2** (0 exact / 2 artist)<br>Nostalgie New York (`nostalgie-new-york`): **2** (0 exact / 2 artist)<br>WORT 89.9 FM (`wort`): **2** (0 exact / 2 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (0 exact / 1 artist)<br>Radio FM (`radio-fm`): **1** (0 exact / 1 artist) |
| 56 | Ozzy Osbourne | **47** | 0 | 47 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **40** (0 exact / 40 artist)<br>Nostalgie New York (`nostalgie-new-york`): **3** (0 exact / 3 artist)<br>KTUH 90.3 FM (`ktuh`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>Synthradio (`synthradio`): **1** (0 exact / 1 artist) |
| 57 | Billy Joel | **46** | 0 | 46 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **20** (0 exact / 20 artist)<br>WLUR 91.5 FM (`wlur`): **7** (0 exact / 7 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **4** (0 exact / 4 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **3** (0 exact / 3 artist)<br>Nostalgie New York (`nostalgie-new-york`): **3** (0 exact / 3 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **2** (0 exact / 2 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist)<br>KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>KTUH 90.3 FM (`ktuh`): **1** (0 exact / 1 artist)<br>Radio Armisa (`radio-armisa`): **1** (0 exact / 1 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>WCFM 91.9 FM (`wcfm`): **1** (0 exact / 1 artist) |
| 58 | Future Islands | **46** | 1 | 45 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **44** (1 exact / 43 artist)<br>WLUR 91.5 FM (`wlur`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 59 | Steely Dan | **46** | 43 | 3 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **18** (18 exact / 0 artist)<br>WLUR 91.5 FM (`wlur`): **4** (4 exact / 0 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **4** (3 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **3** (3 exact / 0 artist)<br>WRBB 104.9 FM (`wrbb`): **3** (3 exact / 0 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **2** (2 exact / 0 artist)<br>KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **2** (2 exact / 0 artist)<br>RadioActive (`radioactive`): **2** (2 exact / 0 artist)<br>SWISS GROOVE (`swiss-groove`): **2** (0 exact / 2 artist)<br>KZSC 88.1 FM (`kzsc`): **1** (1 exact / 0 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (1 exact / 0 artist)<br>Traxx FM - Cool Jam (`traxx-fm-cool-jam`): **1** (1 exact / 0 artist)<br>WCFM 91.9 FM (`wcfm`): **1** (1 exact / 0 artist)<br>WRAS 88.5 FM (`wras`): **1** (1 exact / 0 artist) |
| 60 | Tears For Fears | **46** | 3 | 43 | Big R Radio - The Wave (`big-r-radio-the-wave`): **8** (0 exact / 8 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **8** (0 exact / 8 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **5** (1 exact / 4 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **4** (0 exact / 4 artist)<br>Radio Mela (`radio-mela`): **4** (0 exact / 4 artist)<br>Synthradio (`synthradio`): **3** (1 exact / 2 artist)<br>KZSC 88.1 FM (`kzsc`): **2** (1 exact / 1 artist)<br>RadioActive (`radioactive`): **2** (0 exact / 2 artist)<br>WLUR 91.5 FM (`wlur`): **2** (0 exact / 2 artist)<br>..87,5!. Nantes (`87-5-nantes`): **1** (0 exact / 1 artist)<br>KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist)<br>PANORAMA80 (`panorama80`): **1** (0 exact / 1 artist)<br>Radio FM (`radio-fm`): **1** (0 exact / 1 artist)<br>RMC Nights Story (`rmc-nights-story`): **1** (0 exact / 1 artist) |
| 61 | The Black Angels | **45** | 1 | 44 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **44** (1 exact / 43 artist)<br>KDUR 91.9 FM (`kdur`): **1** (0 exact / 1 artist) |
| 62 | Juana Molina | **43** | 0 | 43 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **39** (0 exact / 39 artist)<br>KCSB 91.9 FM (`kcsb`): **1** (0 exact / 1 artist)<br>KZSC 88.1 FM (`kzsc`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist)<br>WRBB 104.9 FM (`wrbb`): **1** (0 exact / 1 artist) |
| 63 | Oneohtrix Point Never | **43** | 1 | 42 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **31** (1 exact / 30 artist)<br>Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **4** (0 exact / 4 artist)<br>WKNC 88.1 FM (`wknc`): **3** (0 exact / 3 artist)<br>WDCE 90.1 FM (`wdce`): **2** (0 exact / 2 artist)<br>dinamo.fm smog (`dinamo-fm-smog`): **1** (0 exact / 1 artist)<br>KCSB 91.9 FM (`kcsb`): **1** (0 exact / 1 artist)<br>WSUM 91.7 FM (`wsum`): **1** (0 exact / 1 artist) |
| 64 | The Cranberries | **40** | 0 | 40 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **25** (0 exact / 25 artist)<br>Nostalgie New York (`nostalgie-new-york`): **3** (0 exact / 3 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **2** (0 exact / 2 artist)<br>WLUR 91.5 FM (`wlur`): **2** (0 exact / 2 artist)<br>Irish Pub Radio (`irish-pub-radio`): **1** (0 exact / 1 artist)<br>KTUH 90.3 FM (`ktuh`): **1** (0 exact / 1 artist)<br>KZSC 88.1 FM (`kzsc`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>SLOBODNÝ VYSIELAČ (`slobodn-vysiela`): **1** (0 exact / 1 artist)<br>Synthradio (`synthradio`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 65 | The Smashing Pumpkins | **40** | 0 | 40 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **39** (0 exact / 39 artist)<br>WSUM 91.7 FM (`wsum`): **1** (0 exact / 1 artist) |
| 66 | Chelsea Wolfe | **39** | 0 | 39 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **28** (0 exact / 28 artist)<br>Radio FM (`radio-fm`): **3** (0 exact / 3 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **2** (0 exact / 2 artist)<br>WSUM 91.7 FM (`wsum`): **2** (0 exact / 2 artist)<br>6forty Radio (`6forty-radio`): **1** (0 exact / 1 artist)<br>KFAI 90.3 FM (`kfai`): **1** (0 exact / 1 artist)<br>WORT 89.9 FM (`wort`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 67 | ROSALÍA | **39** | 1 | 38 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **35** (1 exact / 34 artist)<br>KAOS 89.3 FM (`kaos`): **1** (0 exact / 1 artist)<br>Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **1** (0 exact / 1 artist)<br>Radio Paradise World/ETC Mix 192k MP3 (`radio-paradise-world-etc-mix-192k-mp3`): **1** (0 exact / 1 artist)<br>Radio Paradise World/Etc Mix 320k AAC (`radio-paradise-world-etc-mix-320k-aac`): **1** (0 exact / 1 artist) |
| 68 | Chinese American Bear | **38** | 1 | 37 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **37** (1 exact / 36 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 69 | Kikagaku Moyo | **38** | 1 | 37 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **31** (1 exact / 30 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **2** (0 exact / 2 artist)<br>Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **1** (0 exact / 1 artist)<br>Radio Paradise World/ETC Mix 192k MP3 (`radio-paradise-world-etc-mix-192k-mp3`): **1** (0 exact / 1 artist)<br>Radio Paradise World/Etc Mix 320k AAC (`radio-paradise-world-etc-mix-320k-aac`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist)<br>WDCE 90.1 FM (`wdce`): **1** (0 exact / 1 artist) |
| 70 | Billy Idol | **37** | 0 | 37 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **20** (0 exact / 20 artist)<br>Nostalgie New York (`nostalgie-new-york`): **5** (0 exact / 5 artist)<br>Big R Radio - The Wave (`big-r-radio-the-wave`): **3** (0 exact / 3 artist)<br>Radio Mela (`radio-mela`): **2** (0 exact / 2 artist)<br>Sfliny Alternative 80's (`sfliny-alternative-80-s`): **2** (0 exact / 2 artist)<br>KFAI 90.3 FM (`kfai`): **1** (0 exact / 1 artist)<br>KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>Radio SAR - Studencka Agencja Radiowa (`radio-sar-studencka-agencja-radiowa`): **1** (0 exact / 1 artist)<br>Synthradio (`synthradio`): **1** (0 exact / 1 artist) |
| 71 | Tangerine Dream | **37** | 1 | 36 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **19** (1 exact / 18 artist)<br>Radio Caprice - Krautrock (`radio-caprice-krautrock`): **15** (0 exact / 15 artist)<br>SomaFM Black Rock FM (128k AAC Non-SSL) (`somafm-black-rock-fm-128k-aac-non-ssl`): **2** (0 exact / 2 artist)<br>PANORAMA80 (`panorama80`): **1** (0 exact / 1 artist) |
| 72 | The Band | **37** | 3 | 34 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **27** (3 exact / 24 artist)<br>Grolloo Radio (`grolloo-radio`): **5** (0 exact / 5 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **2** (0 exact / 2 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>SomaFM Boot Liquor (128k AAC) (`somafm-boot-liquor-128k-aac`): **1** (0 exact / 1 artist)<br>SomaFM Boot Liquor (320k MP3) (`somafm-boot-liquor-320k-mp3`): **1** (0 exact / 1 artist) |
| 73 | ODESZA | **36** | 6 | 30 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **31** (4 exact / 27 artist)<br>SomaFM Black Rock FM (128k AAC Non-SSL) (`somafm-black-rock-fm-128k-aac-non-ssl`): **5** (2 exact / 3 artist) |
| 74 | David Byrne | **35** | 2 | 33 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **33** (2 exact / 31 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 75 | Heart | **35** | 2 | 33 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **30** (1 exact / 29 artist)<br>..87,5!. Nantes (`87-5-nantes`): **1** (0 exact / 1 artist)<br>KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (1 exact / 0 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist)<br>Radio SAR - Studencka Agencja Radiowa (`radio-sar-studencka-agencja-radiowa`): **1** (0 exact / 1 artist) |
| 76 | Panda Bear | **35** | 4 | 31 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **33** (4 exact / 29 artist)<br>KFAI 90.3 FM (`kfai`): **1** (0 exact / 1 artist)<br>WDCE 90.1 FM (`wdce`): **1** (0 exact / 1 artist) |
| 77 | Balmorhea | **34** | 0 | 34 | Radio Caprice - Post-rock (`radio-caprice-post-rock`): **21** (0 exact / 21 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **10** (0 exact / 10 artist)<br>Heavy Music Atmospheric Radio (`heavy-music-atmospheric-radio`): **3** (0 exact / 3 artist) |
| 78 | Genesis | **33** | 0 | 33 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **23** (0 exact / 23 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **2** (0 exact / 2 artist)<br>Radio Mela (`radio-mela`): **2** (0 exact / 2 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **2** (0 exact / 2 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist)<br>KDUR 91.9 FM (`kdur`): **1** (0 exact / 1 artist)<br>KFAI 90.3 FM (`kfai`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist) |
| 79 | Momma | **33** | 0 | 33 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **27** (0 exact / 27 artist)<br>WRBB 104.9 FM (`wrbb`): **2** (0 exact / 2 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **2** (0 exact / 2 artist)<br>KTUH 90.3 FM (`ktuh`): **1** (0 exact / 1 artist)<br>WSUM 91.7 FM (`wsum`): **1** (0 exact / 1 artist) |
| 80 | Tony Allen | **33** | 0 | 33 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **19** (0 exact / 19 artist)<br>Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **4** (0 exact / 4 artist)<br>Radio Paradise World/ETC Mix 192k MP3 (`radio-paradise-world-etc-mix-192k-mp3`): **4** (0 exact / 4 artist)<br>Radio Paradise World/Etc Mix 320k AAC (`radio-paradise-world-etc-mix-320k-aac`): **3** (0 exact / 3 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 81 | Daryl Hall & John Oates | **32** | 0 | 32 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **28** (0 exact / 28 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (0 exact / 1 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist)<br>Radio Mela (`radio-mela`): **1** (0 exact / 1 artist)<br>WEFT 90.1 FM (`weft`): **1** (0 exact / 1 artist) |
| 82 | Deerhoof | **32** | 7 | 25 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **31** (7 exact / 24 artist)<br>WSUM 91.7 FM (`wsum`): **1** (0 exact / 1 artist) |
| 83 | Floating Points | **32** | 0 | 32 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **27** (0 exact / 27 artist)<br>dinamo.fm smog (`dinamo-fm-smog`): **1** (0 exact / 1 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>WKNC 88.1 FM (`wknc`): **1** (0 exact / 1 artist)<br>WRBB 104.9 FM (`wrbb`): **1** (0 exact / 1 artist) |
| 84 | Lady Gaga | **32** | 0 | 32 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **17** (0 exact / 17 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **5** (0 exact / 5 artist)<br>i love radio - greatest hits (`i-love-radio-greatest-hits`): **4** (0 exact / 4 artist)<br>..87,5!. Nantes (`87-5-nantes`): **2** (0 exact / 2 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **2** (0 exact / 2 artist)<br>Radio Armisa (`radio-armisa`): **1** (0 exact / 1 artist)<br>WRBB 104.9 FM (`wrbb`): **1** (0 exact / 1 artist) |
| 85 | Protomartyr | **32** | 0 | 32 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **23** (0 exact / 23 artist)<br>WDCE 90.1 FM (`wdce`): **2** (0 exact / 2 artist)<br>KFAI 90.3 FM (`kfai`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>Radio FM (`radio-fm`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist)<br>WCBN 88.3 FM (`wcbn`): **1** (0 exact / 1 artist)<br>WRBB 104.9 FM (`wrbb`): **1** (0 exact / 1 artist)<br>WSUM 91.7 FM (`wsum`): **1** (0 exact / 1 artist) |
| 86 | Clark | **31** | 2 | 29 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **16** (2 exact / 14 artist)<br>Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **9** (0 exact / 9 artist)<br>dinamo.fm smog (`dinamo-fm-smog`): **3** (0 exact / 3 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>Polushon (`polushon`): **1** (0 exact / 1 artist)<br>WRIR 97.3 FM (`wrir`): **1** (0 exact / 1 artist) |
| 87 | MJ Lenderman | **31** | 0 | 31 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **24** (0 exact / 24 artist)<br>WRBB 104.9 FM (`wrbb`): **3** (0 exact / 3 artist)<br>East Tennessee's Own WDVX 89.9 FM (`east-tennessee-s-own-wdvx-89-9-fm`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist)<br>WUML 91.5 FM (`wuml`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 88 | Red Hot Chili Peppers | **31** | 0 | 31 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **15** (0 exact / 15 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **3** (0 exact / 3 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **2** (0 exact / 2 artist)<br>Nostalgie New York (`nostalgie-new-york`): **2** (0 exact / 2 artist)<br>RadioActive (`radioactive`): **2** (0 exact / 2 artist)<br>WLUR 91.5 FM (`wlur`): **2** (0 exact / 2 artist)<br>Dare-FM (`dare-fm`): **1** (0 exact / 1 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist)<br>KZSC 88.1 FM (`kzsc`): **1** (0 exact / 1 artist)<br>Rovinj FM (`rovinj-fm`): **1** (0 exact / 1 artist)<br>WCFM 91.9 FM (`wcfm`): **1** (0 exact / 1 artist) |
| 89 | All Them Witches | **30** | 1 | 29 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **28** (1 exact / 27 artist)<br>KDUR 91.9 FM (`kdur`): **1** (0 exact / 1 artist)<br>WDCE 90.1 FM (`wdce`): **1** (0 exact / 1 artist) |
| 90 | Phil Collins | **30** | 0 | 30 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **7** (0 exact / 7 artist)<br>Nostalgie New York (`nostalgie-new-york`): **5** (0 exact / 5 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **5** (0 exact / 5 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **3** (0 exact / 3 artist)<br>Pro-Radio (`pro-radio`): **2** (0 exact / 2 artist)<br>Radio Mela (`radio-mela`): **2** (0 exact / 2 artist)<br>KFAI 90.3 FM (`kfai`): **1** (0 exact / 1 artist)<br>KZSC 88.1 FM (`kzsc`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>RMC Voyage Voyage (`rmc-voyage-voyage`): **1** (0 exact / 1 artist)<br>Rovinj FM (`rovinj-fm`): **1** (0 exact / 1 artist) |
| 91 | Turnstile | **30** | 1 | 29 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **27** (1 exact / 26 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **2** (0 exact / 2 artist)<br>WSUM 91.7 FM (`wsum`): **1** (0 exact / 1 artist) |
| 92 | Altın Gün | **29** | 9 | 20 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **10** (3 exact / 7 artist)<br>Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **5** (2 exact / 3 artist)<br>Radio Paradise World/ETC Mix 192k MP3 (`radio-paradise-world-etc-mix-192k-mp3`): **5** (2 exact / 3 artist)<br>Radio Paradise World/Etc Mix 320k AAC (`radio-paradise-world-etc-mix-320k-aac`): **5** (2 exact / 3 artist)<br>..87,5!. Nantes (`87-5-nantes`): **1** (0 exact / 1 artist)<br>C Lab (`c-lab`): **1** (0 exact / 1 artist)<br>WRAS 88.5 FM (`wras`): **1** (0 exact / 1 artist)<br>WUML 91.5 FM (`wuml`): **1** (0 exact / 1 artist) |
| 93 | Britney Spears | **29** | 0 | 29 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **14** (0 exact / 14 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **7** (0 exact / 7 artist)<br>Radio Armisa (`radio-armisa`): **4** (0 exact / 4 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 94 | Maxwell | **29** | 0 | 29 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **17** (0 exact / 17 artist)<br>RMC Nights Story (`rmc-nights-story`): **4** (0 exact / 4 artist)<br>JAMM FM (`jamm-fm`): **2** (0 exact / 2 artist)<br>Traxx FM - Cool Jam (`traxx-fm-cool-jam`): **2** (0 exact / 2 artist)<br>WBEZ-HD2 "Vocalo Stream" Chicago, IL (`wbez-hd2-vocalo-stream-chicago-il`): **2** (0 exact / 2 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>SWISS GROOVE (`swiss-groove`): **1** (0 exact / 1 artist) |
| 95 | This Will Destroy You | **29** | 0 | 29 | Radio Caprice - Post-rock (`radio-caprice-post-rock`): **22** (0 exact / 22 artist)<br>6forty Radio (`6forty-radio`): **4** (0 exact / 4 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (0 exact / 3 artist) |
| 96 | Deftones | **28** | 1 | 27 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **24** (1 exact / 23 artist)<br>Heavy Music Atmospheric Radio (`heavy-music-atmospheric-radio`): **3** (0 exact / 3 artist)<br>KTUH 90.3 FM (`ktuh`): **1** (0 exact / 1 artist) |
| 97 | Hole | **28** | 2 | 26 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **25** (0 exact / 25 artist)<br>KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (1 exact / 0 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (0 exact / 1 artist)<br>WSUM 91.7 FM (`wsum`): **1** (1 exact / 0 artist) |
| 98 | Psychedelic Porn Crumpets | **27** | 0 | 27 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **25** (0 exact / 25 artist)<br>WUML 91.5 FM (`wuml`): **2** (0 exact / 2 artist) |
| 99 | Beach Fossils | **26** | 0 | 26 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **26** (0 exact / 26 artist) |
| 100 | Dead Meadow | **26** | 1 | 25 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **26** (1 exact / 25 artist) |
| 101 | Rush | **26** | 0 | 26 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **22** (0 exact / 22 artist)<br>KZSC 88.1 FM (`kzsc`): **1** (0 exact / 1 artist)<br>WEFT 90.1 FM (`weft`): **1** (0 exact / 1 artist)<br>WRIR 97.3 FM (`wrir`): **1** (0 exact / 1 artist)<br>WSUM 91.7 FM (`wsum`): **1** (0 exact / 1 artist) |
| 102 | Russian Circles | **26** | 1 | 25 | Radio Caprice - Post-rock (`radio-caprice-post-rock`): **19** (0 exact / 19 artist)<br>6forty Radio (`6forty-radio`): **4** (0 exact / 4 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (1 exact / 2 artist) |
| 103 | The Murlocs | **25** | 4 | 21 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **24** (3 exact / 21 artist)<br>WUML 91.5 FM (`wuml`): **1** (1 exact / 0 artist) |
| 104 | TOKiMONSTA | **25** | 0 | 25 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **18** (0 exact / 18 artist)<br>Experimental/Avant-garde music - Radio Caprice (`experimental-avant-garde-music-radio-caprice`): **6** (0 exact / 6 artist)<br>..87,5!. Nantes (`87-5-nantes`): **1** (0 exact / 1 artist) |
| 105 | Bombay Bicycle Club | **24** | 0 | 24 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **22** (0 exact / 22 artist)<br>Radio FM (`radio-fm`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist) |
| 106 | Holy Wave | **24** | 0 | 24 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **20** (0 exact / 20 artist)<br>WDCE 90.1 FM (`wdce`): **2** (0 exact / 2 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 107 | Soul Coughing | **24** | 0 | 24 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **21** (0 exact / 21 artist)<br>aNONradio (`anonradio`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 108 | Public Service Broadcasting | **23** | 0 | 23 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **19** (0 exact / 19 artist)<br>Experimental/Avant-garde music - Radio Caprice (`experimental-avant-garde-music-radio-caprice`): **3** (0 exact / 3 artist)<br>Synthradio (`synthradio`): **1** (0 exact / 1 artist) |
| 109 | The Sisters of Mercy | **23** | 0 | 23 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **20** (0 exact / 20 artist)<br>Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (0 exact / 1 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 110 | Dungen | **22** | 5 | 17 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **20** (5 exact / 15 artist)<br>Polushon (`polushon`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 111 | Mulatu Astatke | **22** | 0 | 22 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **7** (0 exact / 7 artist)<br>Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **4** (0 exact / 4 artist)<br>Radio Paradise World/ETC Mix 192k MP3 (`radio-paradise-world-etc-mix-192k-mp3`): **4** (0 exact / 4 artist)<br>Radio Paradise World/Etc Mix 320k AAC (`radio-paradise-world-etc-mix-320k-aac`): **4** (0 exact / 4 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist)<br>KFAI 90.3 FM (`kfai`): **1** (0 exact / 1 artist)<br>WUML 91.5 FM (`wuml`): **1** (0 exact / 1 artist) |
| 112 | Trentemøller | **22** | 0 | 22 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **19** (0 exact / 19 artist)<br>dinamo.fm smog (`dinamo-fm-smog`): **1** (0 exact / 1 artist)<br>SomaFM Black Rock FM (128k AAC Non-SSL) (`somafm-black-rock-fm-128k-aac-non-ssl`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 113 | Black Moth Super Rainbow | **21** | 2 | 19 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **21** (2 exact / 19 artist) |
| 114 | HEALTH | **21** | 0 | 21 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **19** (0 exact / 19 artist)<br>KDUR 91.9 FM (`kdur`): **1** (0 exact / 1 artist)<br>Radio SAR - Studencka Agencja Radiowa (`radio-sar-studencka-agencja-radiowa`): **1** (0 exact / 1 artist) |
| 115 | Iceage | **21** | 0 | 21 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **19** (0 exact / 19 artist)<br>Radio FM (`radio-fm`): **1** (0 exact / 1 artist)<br>WUML 91.5 FM (`wuml`): **1** (0 exact / 1 artist) |
| 116 | Kaitlyn Aurelia Smith | **21** | 0 | 21 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **17** (0 exact / 17 artist)<br>WRIR 97.3 FM (`wrir`): **2** (0 exact / 2 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 117 | Bronski Beat | **20** | 3 | 17 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **7** (0 exact / 7 artist)<br>Big R Radio - The Wave (`big-r-radio-the-wave`): **6** (1 exact / 5 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **2** (1 exact / 1 artist)<br>Radio Mela (`radio-mela`): **2** (0 exact / 2 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (1 exact / 0 artist)<br>PANORAMA80 (`panorama80`): **1** (0 exact / 1 artist)<br>Sfliny Alternative 80's (`sfliny-alternative-80-s`): **1** (0 exact / 1 artist) |
| 118 | Mahalia Jackson | **20** | 1 | 19 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **20** (1 exact / 19 artist) |
| 119 | Missing Persons | **20** | 3 | 17 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **12** (1 exact / 11 artist)<br>Big R Radio - The Wave (`big-r-radio-the-wave`): **6** (1 exact / 5 artist)<br>WUML 91.5 FM (`wuml`): **1** (1 exact / 0 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 120 | Mk.gee | **20** | 2 | 18 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **17** (2 exact / 15 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 121 | Poliça | **20** | 4 | 16 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **18** (4 exact / 14 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist)<br>WSUM 91.7 FM (`wsum`): **1** (0 exact / 1 artist) |
| 122 | The Mars Volta | **20** | 0 | 20 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **20** (0 exact / 20 artist) |
| 123 | Tommy Guerrero | **20** | 0 | 20 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **18** (0 exact / 18 artist)<br>C Lab (`c-lab`): **1** (0 exact / 1 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist) |
| 124 | Bone Thugs‐n‐Harmony | **19** | 0 | 19 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **17** (0 exact / 17 artist)<br>KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 125 | Chromeo | **19** | 0 | 19 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **16** (0 exact / 16 artist)<br>WBEZ-HD2 "Vocalo Stream" Chicago, IL (`wbez-hd2-vocalo-stream-chicago-il`): **3** (0 exact / 3 artist) |
| 126 | DOOM GONG | **19** | 0 | 19 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **18** (0 exact / 18 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 127 | Jodeci | **19** | 0 | 19 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **15** (0 exact / 15 artist)<br>WBEZ-HD2 "Vocalo Stream" Chicago, IL (`wbez-hd2-vocalo-stream-chicago-il`): **2** (0 exact / 2 artist)<br>JAMM FM (`jamm-fm`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 128 | King Crimson | **19** | 0 | 19 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **15** (0 exact / 15 artist)<br>KZSC 88.1 FM (`kzsc`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>WRBB 104.9 FM (`wrbb`): **1** (0 exact / 1 artist)<br>WRIR 97.3 FM (`wrir`): **1** (0 exact / 1 artist) |
| 129 | Pissed Jeans | **19** | 1 | 18 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **19** (1 exact / 18 artist) |
| 130 | Smashing Pumpkins | **19** | 0 | 19 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **18** (0 exact / 18 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 131 | Squid | **19** | 1 | 18 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **17** (1 exact / 16 artist)<br>KZSC 88.1 FM (`kzsc`): **1** (0 exact / 1 artist)<br>WUML 91.5 FM (`wuml`): **1** (0 exact / 1 artist) |
| 132 | The True Loves | **19** | 1 | 18 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **19** (1 exact / 18 artist) |
| 133 | Woods | **19** | 0 | 19 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **18** (0 exact / 18 artist)<br>WSUM 91.7 FM (`wsum`): **1** (0 exact / 1 artist) |
| 134 | toe | **18** | 0 | 18 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **18** (0 exact / 18 artist) |
| 135 | Elephant Stone | **17** | 1 | 16 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **15** (1 exact / 14 artist)<br>WDCE 90.1 FM (`wdce`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 136 | Jon Hopkins | **17** | 0 | 17 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **10** (0 exact / 10 artist)<br>SomaFM CliqHop IDM (256k MP3) (`somafm-cliqhop-idm-256k-mp3`): **4** (0 exact / 4 artist)<br>dinamo.fm smog (`dinamo-fm-smog`): **2** (0 exact / 2 artist)<br>SomaFM Black Rock FM (`somafm-black-rock-fm`): **1** (0 exact / 1 artist) |
| 137 | Pat Benatar | **17** | 1 | 16 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **11** (1 exact / 10 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **2** (0 exact / 2 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>WLUR 91.5 FM (`wlur`): **1** (0 exact / 1 artist) |
| 138 | Thee Oh Sees | **17** | 0 | 17 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **14** (0 exact / 14 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist)<br>WORT 89.9 FM (`wort`): **1** (0 exact / 1 artist) |
| 139 | William Bell | **17** | 0 | 17 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **17** (0 exact / 17 artist) |
| 140 | Journey | **16** | 1 | 15 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **5** (1 exact / 4 artist)<br>Nostalgie New York (`nostalgie-new-york`): **3** (0 exact / 3 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **2** (0 exact / 2 artist)<br>Radio Armisa (`radio-armisa`): **2** (0 exact / 2 artist)<br>WLUR 91.5 FM (`wlur`): **2** (0 exact / 2 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>Rovinj FM (`rovinj-fm`): **1** (0 exact / 1 artist) |
| 141 | Nancy Sinatra | **16** | 0 | 16 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **13** (0 exact / 13 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist) |
| 142 | Pye Corner Audio | **16** | 0 | 16 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **8** (0 exact / 8 artist)<br>Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **4** (0 exact / 4 artist)<br>dinamo.fm smog (`dinamo-fm-smog`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>Radio FM (`radio-fm`): **1** (0 exact / 1 artist) |
| 143 | The Alan Parsons Project | **16** | 0 | 16 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **7** (0 exact / 7 artist)<br>Nostalgie New York (`nostalgie-new-york`): **3** (0 exact / 3 artist)<br>KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>KTUH 90.3 FM (`ktuh`): **1** (0 exact / 1 artist)<br>Radio Armisa (`radio-armisa`): **1** (0 exact / 1 artist)<br>Traxx FM - Cool Jam (`traxx-fm-cool-jam`): **1** (0 exact / 1 artist)<br>WCBN 88.3 FM (`wcbn`): **1** (0 exact / 1 artist)<br>WUML 91.5 FM (`wuml`): **1** (0 exact / 1 artist) |
| 144 | The Clean | **16** | 0 | 16 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **15** (0 exact / 15 artist)<br>KZSC 88.1 FM (`kzsc`): **1** (0 exact / 1 artist) |
| 145 | Chat Pile | **15** | 0 | 15 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **12** (0 exact / 12 artist)<br>WCFM 91.9 FM (`wcfm`): **2** (0 exact / 2 artist)<br>KDUR 91.9 FM (`kdur`): **1** (0 exact / 1 artist) |
| 146 | Dirty Projectors | **15** | 0 | 15 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **13** (0 exact / 13 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>WDCE 90.1 FM (`wdce`): **1** (0 exact / 1 artist) |
| 147 | Empire of the Sun | **15** | 0 | 15 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **12** (0 exact / 12 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **2** (0 exact / 2 artist)<br>WSUM 91.7 FM (`wsum`): **1** (0 exact / 1 artist) |
| 148 | If These Trees Could Talk | **15** | 0 | 15 | Radio Caprice - Post-rock (`radio-caprice-post-rock`): **10** (0 exact / 10 artist)<br>6forty Radio (`6forty-radio`): **3** (0 exact / 3 artist)<br>Heavy Music Atmospheric Radio (`heavy-music-atmospheric-radio`): **2** (0 exact / 2 artist) |
| 149 | John Maus | **15** | 0 | 15 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **8** (0 exact / 8 artist)<br>PANORAMA80 (`panorama80`): **3** (0 exact / 3 artist)<br>XWave Radio (`xwave-radio`): **2** (0 exact / 2 artist)<br>KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 150 | Son Lux | **15** | 0 | 15 | Experimental/Avant-garde music - Radio Caprice (`experimental-avant-garde-music-radio-caprice`): **10** (0 exact / 10 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **5** (0 exact / 5 artist) |
| 151 | The Blue Nile | **15** | 4 | 11 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **12** (1 exact / 11 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (1 exact / 0 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (1 exact / 0 artist)<br>WRBB 104.9 FM (`wrbb`): **1** (1 exact / 0 artist) |
| 152 | Wine Lips | **15** | 2 | 13 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **15** (2 exact / 13 artist) |
| 153 | Arc De Soleil | **14** | 2 | 12 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **12** (2 exact / 10 artist)<br>KFAI 90.3 FM (`kfai`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 154 | Cars | **14** | 3 | 11 | Big R Radio - The Wave (`big-r-radio-the-wave`): **10** (1 exact / 9 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (1 exact / 1 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>WLUR 91.5 FM (`wlur`): **1** (1 exact / 0 artist) |
| 155 | Discovery Zone | **14** | 0 | 14 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **10** (0 exact / 10 artist)<br>WDCE 90.1 FM (`wdce`): **2** (0 exact / 2 artist)<br>WRIR 97.3 FM (`wrir`): **2** (0 exact / 2 artist) |
| 156 | Drugdealer | **14** | 1 | 13 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **12** (1 exact / 11 artist)<br>WDCE 90.1 FM (`wdce`): **1** (0 exact / 1 artist)<br>WUML 91.5 FM (`wuml`): **1** (0 exact / 1 artist) |
| 157 | Dylan Henner | **14** | 0 | 14 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **12** (0 exact / 12 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 158 | LADY GAGA | **14** | 0 | 14 | i love radio - greatest hits (`i-love-radio-greatest-hits`): **4** (0 exact / 4 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **2** (0 exact / 2 artist)<br>Radio Armisa (`radio-armisa`): **2** (0 exact / 2 artist)<br>..87,5!. Nantes (`87-5-nantes`): **1** (0 exact / 1 artist)<br>BANDA 93.3 (Monterrey) - 93.3 FM - XHQQ-FM - Grupo Radio Centro - Monterrey, NL (`banda-93-3-monterrey-93-3-fm-xhqq-fm-grupo-radio-centro-monterrey-nl`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>Star 88.8 (`star-88-8`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>WLUR 91.5 FM (`wlur`): **1** (0 exact / 1 artist) |
| 159 | Rothko | **14** | 0 | 14 | Radio Caprice - Post-rock (`radio-caprice-post-rock`): **14** (0 exact / 14 artist) |
| 160 | The Nude Party | **14** | 0 | 14 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **13** (0 exact / 13 artist)<br>WDCE 90.1 FM (`wdce`): **1** (0 exact / 1 artist) |
| 161 | Counting Crows | **13** | 0 | 13 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **4** (0 exact / 4 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **2** (0 exact / 2 artist)<br>WLUR 91.5 FM (`wlur`): **2** (0 exact / 2 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist)<br>WUMB (`wumb`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 162 | Crosby, Stills, Nash & Young | **13** | 0 | 13 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **13** (0 exact / 13 artist) |
| 163 | Deafheaven | **13** | 1 | 12 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **12** (1 exact / 11 artist)<br>WUML 91.5 FM (`wuml`): **1** (0 exact / 1 artist) |
| 164 | Die Spitz | **13** | 4 | 9 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **9** (3 exact / 6 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **2** (0 exact / 2 artist)<br>KDUR 91.9 FM (`kdur`): **1** (1 exact / 0 artist)<br>WDCE 90.1 FM (`wdce`): **1** (0 exact / 1 artist) |
| 165 | Emerson, Lake & Palmer | **13** | 0 | 13 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **11** (0 exact / 11 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist)<br>WDCE 90.1 FM (`wdce`): **1** (0 exact / 1 artist) |
| 166 | Fuzz | **13** | 1 | 12 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **13** (1 exact / 12 artist) |
| 167 | Hum | **13** | 1 | 12 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **8** (1 exact / 7 artist)<br>6forty Radio (`6forty-radio`): **2** (0 exact / 2 artist)<br>WEFT 90.1 FM (`weft`): **2** (0 exact / 2 artist)<br>WRBB 104.9 FM (`wrbb`): **1** (0 exact / 1 artist) |
| 168 | Levitation Room | **13** | 0 | 13 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **13** (0 exact / 13 artist) |
| 169 | The Holydrug Couple | **13** | 1 | 12 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **13** (1 exact / 12 artist) |
| 170 | Toadies | **13** | 0 | 13 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **13** (0 exact / 13 artist) |
| 171 | Chris Cornell | **12** | 1 | 11 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **12** (1 exact / 11 artist) |
| 172 | GORILLAZ | **12** | 0 | 12 | Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **2** (0 exact / 2 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist)<br>C Lab (`c-lab`): **1** (0 exact / 1 artist)<br>i love radio - greatest hits (`i-love-radio-greatest-hits`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>Radio Armisa (`radio-armisa`): **1** (0 exact / 1 artist)<br>Radio FM (`radio-fm`): **1** (0 exact / 1 artist)<br>Synthradio (`synthradio`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 173 | Pearl Jam | **12** | 8 | 4 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **8** (8 exact / 0 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **2** (0 exact / 2 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>WSUM 91.7 FM (`wsum`): **1** (0 exact / 1 artist) |
| 174 | Ratatat | **12** | 3 | 9 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **12** (3 exact / 9 artist) |
| 175 | SLIFT | **12** | 0 | 12 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **8** (0 exact / 8 artist)<br>WRIR 97.3 FM (`wrir`): **2** (0 exact / 2 artist)<br>KTUH 90.3 FM (`ktuh`): **1** (0 exact / 1 artist)<br>WDCE 90.1 FM (`wdce`): **1** (0 exact / 1 artist) |
| 176 | Title Fight | **12** | 1 | 11 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **10** (1 exact / 9 artist)<br>KZSC 88.1 FM (`kzsc`): **1** (0 exact / 1 artist)<br>WRBB 104.9 FM (`wrbb`): **1** (0 exact / 1 artist) |
| 177 | Yin Yin | **12** | 0 | 12 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **4** (0 exact / 4 artist)<br>Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **2** (0 exact / 2 artist)<br>Radio Paradise World/ETC Mix 192k MP3 (`radio-paradise-world-etc-mix-192k-mp3`): **2** (0 exact / 2 artist)<br>Radio Paradise World/Etc Mix 320k AAC (`radio-paradise-world-etc-mix-320k-aac`): **2** (0 exact / 2 artist)<br>C Lab (`c-lab`): **1** (0 exact / 1 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist) |
| 178 | Brian Jonestown Massacre | **11** | 0 | 11 | DKFM Classic (`dkfm-classic`): **8** (0 exact / 8 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (0 exact / 3 artist) |
| 179 | Castle Rat | **11** | 1 | 10 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **10** (1 exact / 9 artist)<br>KFAI 90.3 FM (`kfai`): **1** (0 exact / 1 artist) |
| 180 | Creedence Clearwater Revival | **11** | 8 | 3 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **2** (1 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **2** (1 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (2 exact / 0 artist)<br>East Tennessee's Own WDVX 89.9 FM (`east-tennessee-s-own-wdvx-89-9-fm`): **1** (0 exact / 1 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (1 exact / 0 artist)<br>KTUH 90.3 FM (`ktuh`): **1** (1 exact / 0 artist)<br>Radio SAR - Studencka Agencja Radiowa (`radio-sar-studencka-agencja-radiowa`): **1** (1 exact / 0 artist)<br>RadioActive (`radioactive`): **1** (1 exact / 0 artist) |
| 181 | Nathan Fake | **11** | 0 | 11 | dinamo.fm smog (`dinamo-fm-smog`): **4** (0 exact / 4 artist)<br>Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **3** (0 exact / 3 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **2** (0 exact / 2 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 182 | Bone Thugs-N-Harmony | **10** | 0 | 10 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **8** (0 exact / 8 artist)<br>KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>RMC Voyage Voyage (`rmc-voyage-voyage`): **1** (0 exact / 1 artist) |
| 183 | Colourbox | **10** | 0 | 10 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **9** (0 exact / 9 artist)<br>PANORAMA80 (`panorama80`): **1** (0 exact / 1 artist) |
| 184 | Delta Sleep | **10** | 0 | 10 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **10** (0 exact / 10 artist) |
| 185 | Deradoorian | **10** | 1 | 9 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **7** (1 exact / 6 artist)<br>WSUM 91.7 FM (`wsum`): **2** (0 exact / 2 artist)<br>WDCE 90.1 FM (`wdce`): **1** (0 exact / 1 artist) |
| 186 | Guns N’ Roses | **10** | 0 | 10 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **10** (0 exact / 10 artist) |
| 187 | Light Asylum | **10** | 2 | 8 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **10** (2 exact / 8 artist) |
| 188 | NINA SIMONE | **10** | 0 | 10 | Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **3** (0 exact / 3 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **3** (0 exact / 3 artist)<br>KZSC 88.1 FM (`kzsc`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>SWISS GROOVE (`swiss-groove`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 189 | Rufus & Chaka Khan | **10** | 0 | 10 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **10** (0 exact / 10 artist) |
| 190 | The Dukes of Stratosphear | **10** | 0 | 10 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **10** (0 exact / 10 artist) |
| 191 | Vulfpeck | **10** | 4 | 6 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **8** (3 exact / 5 artist)<br>C Lab (`c-lab`): **1** (1 exact / 0 artist)<br>WCBN 88.3 FM (`wcbn`): **1** (0 exact / 1 artist) |
| 192 | Dave Matthews Band | **9** | 0 | 9 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **6** (0 exact / 6 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist)<br>WLUR 91.5 FM (`wlur`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 193 | Delicate Steve | **9** | 1 | 8 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **7** (1 exact / 6 artist)<br>WSUM 91.7 FM (`wsum`): **2** (0 exact / 2 artist) |
| 194 | Forest Swords | **9** | 0 | 9 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **5** (0 exact / 5 artist)<br>Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **2** (0 exact / 2 artist)<br>Experimental/Avant-garde music - Radio Caprice (`experimental-avant-garde-music-radio-caprice`): **1** (0 exact / 1 artist)<br>KCSB 91.9 FM (`kcsb`): **1** (0 exact / 1 artist) |
| 195 | Ghost | **9** | 0 | 9 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **7** (0 exact / 7 artist)<br>dinamo.fm smog (`dinamo-fm-smog`): **1** (0 exact / 1 artist)<br>SomaFM CliqHop IDM (256k MP3) (`somafm-cliqhop-idm-256k-mp3`): **1** (0 exact / 1 artist) |
| 196 | Heathered Pearls | **9** | 0 | 9 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **4** (0 exact / 4 artist)<br>dinamo.fm smog (`dinamo-fm-smog`): **3** (0 exact / 3 artist)<br>Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **2** (0 exact / 2 artist) |
| 197 | Jessica Lea Mayfield | **9** | 0 | 9 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **8** (0 exact / 8 artist)<br>WDCE 90.1 FM (`wdce`): **1** (0 exact / 1 artist) |
| 198 | levitation room | **9** | 1 | 8 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **8** (1 exact / 7 artist)<br>WUML 91.5 FM (`wuml`): **1** (0 exact / 1 artist) |
| 199 | PINK FLOYD | **9** | 6 | 3 | Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **3** (2 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **3** (2 exact / 1 artist)<br>Radio SAR - Studencka Agencja Radiowa (`radio-sar-studencka-agencja-radiowa`): **1** (1 exact / 0 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 200 | THE BEATLES | **9** | 0 | 9 | Radio SAR - Studencka Agencja Radiowa (`radio-sar-studencka-agencja-radiowa`): **3** (0 exact / 3 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **2** (0 exact / 2 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>Radio FM (`radio-fm`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 201 | The Black Dog | **9** | 1 | 8 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **6** (1 exact / 5 artist)<br>Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **2** (0 exact / 2 artist)<br>KTUH 90.3 FM (`ktuh`): **1** (0 exact / 1 artist) |
| 202 | The Bobby Fuller Four | **9** | 2 | 7 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **6** (1 exact / 5 artist)<br>WORT 89.9 FM (`wort`): **3** (1 exact / 2 artist) |
| 203 | The Field | **9** | 0 | 9 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **6** (0 exact / 6 artist)<br>dinamo.fm smog (`dinamo-fm-smog`): **1** (0 exact / 1 artist)<br>Radio FM (`radio-fm`): **1** (0 exact / 1 artist)<br>WEFT 90.1 FM (`weft`): **1** (0 exact / 1 artist) |
| 204 | The Glove | **9** | 0 | 9 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **7** (0 exact / 7 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 205 | The Lazy Eyes | **9** | 2 | 7 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **9** (2 exact / 7 artist) |
| 206 | Tim Hecker | **9** | 0 | 9 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **6** (0 exact / 6 artist)<br>Experimental/Avant-garde music - Radio Caprice (`experimental-avant-garde-music-radio-caprice`): **2** (0 exact / 2 artist)<br>dinamo.fm smog (`dinamo-fm-smog`): **1** (0 exact / 1 artist) |
| 207 | Astrid Sonne | **8** | 0 | 8 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **5** (0 exact / 5 artist)<br>aNONradio (`anonradio`): **1** (0 exact / 1 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist)<br>WSUM 91.7 FM (`wsum`): **1** (0 exact / 1 artist) |
| 208 | At the Drive‐In | **8** | 0 | 8 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **6** (0 exact / 6 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **2** (0 exact / 2 artist) |
| 209 | Beach Boys | **8** | 0 | 8 | Lolli Radio Happy Station (`lolli-radio-happy-station`): **5** (0 exact / 5 artist)<br>Nostalgie New York (`nostalgie-new-york`): **3** (0 exact / 3 artist) |
| 210 | Holy Fawn | **8** | 0 | 8 | Radio Caprice - Post-rock (`radio-caprice-post-rock`): **6** (0 exact / 6 artist)<br>6forty Radio (`6forty-radio`): **2** (0 exact / 2 artist) |
| 211 | Pelican | **8** | 0 | 8 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **6** (0 exact / 6 artist)<br>6forty Radio (`6forty-radio`): **2** (0 exact / 2 artist) |
| 212 | Slothrust | **8** | 0 | 8 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **6** (0 exact / 6 artist)<br>WCFM 91.9 FM (`wcfm`): **1** (0 exact / 1 artist)<br>WKNC 88.1 FM (`wknc`): **1** (0 exact / 1 artist) |
| 213 | Surprise Chef | **8** | 1 | 7 | C Lab (`c-lab`): **2** (0 exact / 2 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (1 exact / 1 artist)<br>KZSC 88.1 FM (`kzsc`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>WCBN 88.3 FM (`wcbn`): **1** (0 exact / 1 artist) |
| 214 | The Claypool Lennon Delirium | **8** | 1 | 7 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **7** (1 exact / 6 artist)<br>WCBN 88.3 FM (`wcbn`): **1** (0 exact / 1 artist) |
| 215 | The HU | **8** | 0 | 8 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **8** (0 exact / 8 artist) |
| 216 | Topographies | **8** | 0 | 8 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **8** (0 exact / 8 artist) |
| 217 | Ulver | **8** | 0 | 8 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **4** (0 exact / 4 artist)<br>DJ 666 Geordieblackcore (`dj-666-geordieblackcore`): **2** (0 exact / 2 artist)<br>Experimental/Avant-garde music - Radio Caprice (`experimental-avant-garde-music-radio-caprice`): **2** (0 exact / 2 artist) |
| 218 | Vitamin String Quartet | **8** | 0 | 8 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **8** (0 exact / 8 artist) |
| 219 | Alain Goraguer | **7** | 0 | 7 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **6** (0 exact / 6 artist)<br>shirley & spinoza (`shirley-spinoza`): **1** (0 exact / 1 artist) |
| 220 | Beatles | **7** | 0 | 7 | RadioActive (`radioactive`): **3** (0 exact / 3 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (0 exact / 3 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist) |
| 221 | Guns N Roses | **7** | 0 | 7 | Nostalgie New York (`nostalgie-new-york`): **5** (0 exact / 5 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 222 | Jim Croce | **7** | 0 | 7 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **5** (0 exact / 5 artist)<br>SomaFM Boot Liquor (128k AAC) (`somafm-boot-liquor-128k-aac`): **1** (0 exact / 1 artist)<br>SomaFM Boot Liquor (320k MP3) (`somafm-boot-liquor-320k-mp3`): **1** (0 exact / 1 artist) |
| 223 | L'Eclair | **7** | 1 | 6 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **7** (1 exact / 6 artist) |
| 224 | Mazzy Star | **7** | 7 | 0 | KTUH 90.3 FM (`ktuh`): **1** (1 exact / 0 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist)<br>WLUR 91.5 FM (`wlur`): **1** (1 exact / 0 artist)<br>WRBB 104.9 FM (`wrbb`): **1** (1 exact / 0 artist)<br>WSUM 91.7 FM (`wsum`): **1** (1 exact / 0 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (1 exact / 0 artist) |
| 225 | Mr.Kitty | **7** | 3 | 4 | Synthradio (`synthradio`): **4** (1 exact / 3 artist)<br>Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **2** (1 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 226 | Rachika Nayar | **7** | 0 | 7 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **7** (0 exact / 7 artist) |
| 227 | Sugar Candy Mountain | **7** | 7 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **7** (7 exact / 0 artist) |
| 228 | 16 Horsepower | **6** | 0 | 6 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **5** (0 exact / 5 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist) |
| 229 | 2 Chainz | **6** | 0 | 6 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **6** (0 exact / 6 artist) |
| 230 | Bananarama | **6** | 3 | 3 | Lolli Radio Happy Station (`lolli-radio-happy-station`): **2** (1 exact / 1 artist)<br>..87,5!. Nantes (`87-5-nantes`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (1 exact / 0 artist)<br>Radio Mela (`radio-mela`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 231 | Big Brother & the Holding Company | **6** | 0 | 6 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **6** (0 exact / 6 artist) |
| 232 | Brian Wilson | **6** | 0 | 6 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **6** (0 exact / 6 artist) |
| 233 | Don Henley | **6** | 2 | 4 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist)<br>aNONradio (`anonradio`): **1** (1 exact / 0 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist)<br>Pro-Radio (`pro-radio`): **1** (1 exact / 0 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 234 | Donnie & Joe Emerson | **6** | 3 | 3 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **5** (2 exact / 3 artist)<br>WUML 91.5 FM (`wuml`): **1** (1 exact / 0 artist) |
| 235 | Hans Zimmer | **6** | 0 | 6 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **5** (0 exact / 5 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 236 | Imaginary Softwoods | **6** | 0 | 6 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **6** (0 exact / 6 artist) |
| 237 | James Gang | **6** | 1 | 5 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **5** (0 exact / 5 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (1 exact / 0 artist) |
| 238 | Kangding Ray | **6** | 0 | 6 | Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **4** (0 exact / 4 artist)<br>Experimental/Avant-garde music - Radio Caprice (`experimental-avant-garde-music-radio-caprice`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 239 | Leon Vynehall | **6** | 0 | 6 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **6** (0 exact / 6 artist) |
| 240 | Max Cooper | **6** | 0 | 6 | dinamo.fm smog (`dinamo-fm-smog`): **4** (0 exact / 4 artist)<br>Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 241 | Monolord | **6** | 2 | 4 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **5** (1 exact / 4 artist)<br>WKNC 88.1 FM (`wknc`): **1** (1 exact / 0 artist) |
| 242 | Morrissey | **6** | 0 | 6 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (0 exact / 3 artist)<br>Radio FM (`radio-fm`): **1** (0 exact / 1 artist)<br>Radio Mela (`radio-mela`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist) |
| 243 | Murcof | **6** | 0 | 6 | dinamo.fm smog (`dinamo-fm-smog`): **2** (0 exact / 2 artist)<br>SomaFM CliqHop IDM (256k MP3) (`somafm-cliqhop-idm-256k-mp3`): **2** (0 exact / 2 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist) |
| 244 | Refused | **6** | 0 | 6 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **6** (0 exact / 6 artist) |
| 245 | St. Paul & The Broken Bones | **6** | 0 | 6 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **6** (0 exact / 6 artist) |
| 246 | Tenacious D | **6** | 0 | 6 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **6** (0 exact / 6 artist) |
| 247 | White Noise | **6** | 0 | 6 | Experimental/Avant-garde music - Radio Caprice (`experimental-avant-garde-music-radio-caprice`): **3** (0 exact / 3 artist)<br>shirley & spinoza (`shirley-spinoza`): **2** (0 exact / 2 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 248 | Beach House | **5** | 1 | 4 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (1 exact / 2 artist)<br>KZSC 88.1 FM (`kzsc`): **1** (0 exact / 1 artist)<br>WSUM 91.7 FM (`wsum`): **1** (0 exact / 1 artist) |
| 249 | BILLY JOEL | **5** | 0 | 5 | Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **2** (0 exact / 2 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist) |
| 250 | Broadcast | **5** | 3 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (2 exact / 1 artist)<br>Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **1** (0 exact / 1 artist)<br>WRBB 104.9 FM (`wrbb`): **1** (1 exact / 0 artist) |
| 251 | Dick Dale | **5** | 0 | 5 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **5** (0 exact / 5 artist) |
| 252 | Eagles | **5** | 1 | 4 | WLUR 91.5 FM (`wlur`): **2** (0 exact / 2 artist)<br>KDUR 91.9 FM (`kdur`): **1** (0 exact / 1 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 253 | GoGo Penguin | **5** | 0 | 5 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (0 exact / 3 artist)<br>Pro-Radio (`pro-radio`): **2** (0 exact / 2 artist) |
| 254 | Greta Van Fleet | **5** | 1 | 4 | Radio SAR - Studencka Agencja Radiowa (`radio-sar-studencka-agencja-radiowa`): **5** (1 exact / 4 artist) |
| 255 | Jerry Garcia Band | **5** | 0 | 5 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **4** (0 exact / 4 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 256 | Karnivool | **5** | 0 | 5 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **4** (0 exact / 4 artist)<br>KFAI 90.3 FM (`kfai`): **1** (0 exact / 1 artist) |
| 257 | King Harvest | **5** | 5 | 0 | Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (1 exact / 0 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (1 exact / 0 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (1 exact / 0 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (1 exact / 0 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (1 exact / 0 artist) |
| 258 | King Woman | **5** | 2 | 3 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **4** (2 exact / 2 artist)<br>WSUM 91.7 FM (`wsum`): **1** (0 exact / 1 artist) |
| 259 | Kyuss | **5** | 0 | 5 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **5** (0 exact / 5 artist) |
| 260 | Li Yilei | **5** | 0 | 5 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **5** (0 exact / 5 artist) |
| 261 | Manuel Göttsching | **5** | 0 | 5 | Radio Caprice - Krautrock (`radio-caprice-krautrock`): **4** (0 exact / 4 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 262 | Mark Morrison | **5** | 5 | 0 | JAMM FM (`jamm-fm`): **1** (1 exact / 0 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (1 exact / 0 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist)<br>WBEZ-HD2 "Vocalo Stream" Chicago, IL (`wbez-hd2-vocalo-stream-chicago-il`): **1** (1 exact / 0 artist) |
| 263 | Mr. Bungle | **5** | 0 | 5 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **5** (0 exact / 5 artist) |
| 264 | PETER GABRIEL | **5** | 0 | 5 | Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **3** (0 exact / 3 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>WLUR 91.5 FM (`wlur`): **1** (0 exact / 1 artist) |
| 265 | POLIÇA | **5** | 0 | 5 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **5** (0 exact / 5 artist) |
| 266 | Rosalía | **5** | 0 | 5 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist)<br>Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **1** (0 exact / 1 artist)<br>Radio Paradise World/ETC Mix 192k MP3 (`radio-paradise-world-etc-mix-192k-mp3`): **1** (0 exact / 1 artist)<br>Radio Paradise World/Etc Mix 320k AAC (`radio-paradise-world-etc-mix-320k-aac`): **1** (0 exact / 1 artist) |
| 267 | Roy Orbison | **5** | 0 | 5 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 268 | Sleep | **5** | 0 | 5 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **5** (0 exact / 5 artist) |
| 269 | Sleepy Sun | **5** | 1 | 4 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **5** (1 exact / 4 artist) |
| 270 | Smiths | **5** | 0 | 5 | Big R Radio - The Wave (`big-r-radio-the-wave`): **4** (0 exact / 4 artist)<br>Dare-FM (`dare-fm`): **1** (0 exact / 1 artist) |
| 271 | Starbenders | **5** | 0 | 5 | WUML 91.5 FM (`wuml`): **5** (0 exact / 5 artist) |
| 272 | Suicide | **5** | 4 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **4** (4 exact / 0 artist)<br>XWave Radio (`xwave-radio`): **1** (0 exact / 1 artist) |
| 273 | Taleen Kali | **5** | 1 | 4 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **5** (1 exact / 4 artist) |
| 274 | Tame Impala | **5** | 5 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (2 exact / 0 artist)<br>FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (1 exact / 0 artist)<br>KTUH 90.3 FM (`ktuh`): **1** (1 exact / 0 artist)<br>WLUR 91.5 FM (`wlur`): **1** (1 exact / 0 artist) |
| 275 | Teddy Swims | **5** | 3 | 2 | i love radio - greatest hits (`i-love-radio-greatest-hits`): **1** (1 exact / 0 artist)<br>MFM STATION (`mfm-station`): **1** (0 exact / 1 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (1 exact / 0 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>Rovinj FM (`rovinj-fm`): **1** (1 exact / 0 artist) |
| 276 | THE CURE | **5** | 0 | 5 | KZSC 88.1 FM (`kzsc`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>WLUR 91.5 FM (`wlur`): **1** (0 exact / 1 artist) |
| 277 | The Divine Comedy | **5** | 0 | 5 | Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **3** (0 exact / 3 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>PANORAMA80 (`panorama80`): **1** (0 exact / 1 artist) |
| 278 | The Donnas | **5** | 5 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **5** (5 exact / 0 artist) |
| 279 | The Psychedelic Aliens | **5** | 1 | 4 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **5** (1 exact / 4 artist) |
| 280 | They Are Gutting a Body of Water | **5** | 0 | 5 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (0 exact / 3 artist)<br>WRBB 104.9 FM (`wrbb`): **1** (0 exact / 1 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 281 | Tom Tom Club | **5** | 5 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (2 exact / 0 artist)<br>Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (1 exact / 0 artist)<br>WLUR 91.5 FM (`wlur`): **1** (1 exact / 0 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (1 exact / 0 artist) |
| 282 | Alessandro Cortini | **4** | 0 | 4 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist)<br>Radio SAR - Studencka Agencja Radiowa (`radio-sar-studencka-agencja-radiowa`): **1** (0 exact / 1 artist)<br>Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **1** (0 exact / 1 artist) |
| 283 | Ariel Pink | **4** | 0 | 4 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (0 exact / 3 artist)<br>KTUH 90.3 FM (`ktuh`): **1** (0 exact / 1 artist) |
| 284 | Boards of Canada | **4** | 4 | 0 | PANORAMA80 (`panorama80`): **1** (1 exact / 0 artist)<br>Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist)<br>WUML 91.5 FM (`wuml`): **1** (1 exact / 0 artist) |
| 285 | Buena Vista Social Club | **4** | 4 | 0 | Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **1** (1 exact / 0 artist)<br>Radio Paradise World/ETC Mix 192k MP3 (`radio-paradise-world-etc-mix-192k-mp3`): **1** (1 exact / 0 artist)<br>Radio Paradise World/Etc Mix 320k AAC (`radio-paradise-world-etc-mix-320k-aac`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 286 | Cure | **4** | 0 | 4 | Big R Radio - The Wave (`big-r-radio-the-wave`): **3** (0 exact / 3 artist)<br>Dare-FM (`dare-fm`): **1** (0 exact / 1 artist) |
| 287 | David Gilmour | **4** | 0 | 4 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist)<br>KFAI 90.3 FM (`kfai`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist) |
| 288 | Ed O’Brien | **4** | 0 | 4 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **4** (0 exact / 4 artist) |
| 289 | Elder | **4** | 0 | 4 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **4** (0 exact / 4 artist) |
| 290 | FELA KUTI | **4** | 0 | 4 | C Lab (`c-lab`): **1** (0 exact / 1 artist)<br>Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **1** (0 exact / 1 artist)<br>Radio Paradise World/ETC Mix 192k MP3 (`radio-paradise-world-etc-mix-192k-mp3`): **1** (0 exact / 1 artist)<br>Radio Paradise World/Etc Mix 320k AAC (`radio-paradise-world-etc-mix-320k-aac`): **1** (0 exact / 1 artist) |
| 291 | Graham Nash | **4** | 0 | 4 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **4** (0 exact / 4 artist) |
| 292 | Ishmael Ensemble | **4** | 0 | 4 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **4** (0 exact / 4 artist) |
| 293 | KING CRIMSON | **4** | 0 | 4 | Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>Radio SAR - Studencka Agencja Radiowa (`radio-sar-studencka-agencja-radiowa`): **1** (0 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist) |
| 294 | KOKOROKO | **4** | 4 | 0 | Radio Paradise World/etc FLAC+meta (`radio-paradise-world-etc-flac-meta`): **1** (1 exact / 0 artist)<br>Radio Paradise World/ETC Mix 192k MP3 (`radio-paradise-world-etc-mix-192k-mp3`): **1** (1 exact / 0 artist)<br>Radio Paradise World/Etc Mix 320k AAC (`radio-paradise-world-etc-mix-320k-aac`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 295 | Lo Moon | **4** | 0 | 4 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **4** (0 exact / 4 artist) |
| 296 | Mystic Braves | **4** | 0 | 4 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **4** (0 exact / 4 artist) |
| 297 | NEIL YOUNG | **4** | 0 | 4 | Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **3** (0 exact / 3 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist) |
| 298 | Nothing But Thieves | **4** | 0 | 4 | Synthradio (`synthradio`): **3** (0 exact / 3 artist)<br>WEFT 90.1 FM (`weft`): **1** (0 exact / 1 artist) |
| 299 | RED HOT CHILI PEPPERS | **4** | 0 | 4 | Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **2** (0 exact / 2 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 300 | Rolo Tomassi | **4** | 0 | 4 | 6forty Radio (`6forty-radio`): **2** (0 exact / 2 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist) |
| 301 | Rozi Plain | **4** | 1 | 3 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **4** (1 exact / 3 artist) |
| 302 | Sade | **4** | 4 | 0 | Nostalgie New York (`nostalgie-new-york`): **1** (1 exact / 0 artist)<br>Radio Mela (`radio-mela`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist)<br>Traxx FM - Cool Jam (`traxx-fm-cool-jam`): **1** (1 exact / 0 artist) |
| 303 | Sea Wolf | **4** | 1 | 3 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **4** (1 exact / 3 artist) |
| 304 | Shaboozey | **4** | 4 | 0 | i love radio - greatest hits (`i-love-radio-greatest-hits`): **1** (1 exact / 0 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (1 exact / 0 artist)<br>Rovinj FM (`rovinj-fm`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 305 | Shuggie Otis | **4** | 4 | 0 | KZSC 88.1 FM (`kzsc`): **1** (1 exact / 0 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (1 exact / 0 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 306 | Slift | **4** | 0 | 4 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **4** (0 exact / 4 artist) |
| 307 | Sofie Birch | **4** | 0 | 4 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (0 exact / 3 artist)<br>WDCE 90.1 FM (`wdce`): **1** (0 exact / 1 artist) |
| 308 | STEELY DAN | **4** | 4 | 0 | Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **2** (2 exact / 0 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (1 exact / 0 artist)<br>WLUR 91.5 FM (`wlur`): **1** (1 exact / 0 artist) |
| 309 | THE ALAN PARSONS PROJECT | **4** | 0 | 4 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist) |
| 310 | The Flaming Lips | **4** | 4 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **4** (4 exact / 0 artist) |
| 311 | The Foundations | **4** | 0 | 4 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (0 exact / 1 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist) |
| 312 | The Growlers | **4** | 0 | 4 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (0 exact / 3 artist)<br>KDUR 91.9 FM (`kdur`): **1** (0 exact / 1 artist) |
| 313 | The Sisters Of Mercy | **4** | 0 | 4 | Big R Radio - The Wave (`big-r-radio-the-wave`): **4** (0 exact / 4 artist) |
| 314 | The Sword | **4** | 0 | 4 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **4** (0 exact / 4 artist) |
| 315 | Tom Petty And The Heartbreakers | **4** | 4 | 0 | KZSC 88.1 FM (`kzsc`): **1** (1 exact / 0 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (1 exact / 0 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (1 exact / 0 artist)<br>WEFT 90.1 FM (`weft`): **1** (1 exact / 0 artist) |
| 316 | Viagra Boys | **4** | 3 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (2 exact / 1 artist)<br>WPKN 89.5 FM (`wpkn`): **1** (1 exact / 0 artist) |
| 317 | Whitney Houston | **4** | 4 | 0 | Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (1 exact / 0 artist)<br>Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (1 exact / 0 artist)<br>SLOBODNÝ VYSIELAČ (`slobodn-vysiela`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 318 | Chris Squire | **3** | 0 | 3 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (0 exact / 3 artist) |
| 319 | Client_03 | **3** | 0 | 3 | Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **2** (0 exact / 2 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 320 | Cloudkicker | **3** | 0 | 3 | 6forty Radio (`6forty-radio`): **3** (0 exact / 3 artist) |
| 321 | Connan Mockasin | **3** | 3 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (2 exact / 0 artist)<br>C Lab (`c-lab`): **1** (1 exact / 0 artist) |
| 322 | Courtesy | **3** | 0 | 3 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (0 exact / 3 artist) |
| 323 | Crosby & Nash | **3** | 0 | 3 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (0 exact / 3 artist) |
| 324 | Dehd | **3** | 3 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (2 exact / 0 artist)<br>KDUR 91.9 FM (`kdur`): **1** (1 exact / 0 artist) |
| 325 | Donna Summer | **3** | 3 | 0 | JAMM FM (`jamm-fm`): **1** (1 exact / 0 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 326 | Dramatist | **3** | 0 | 3 | KDUR 91.9 FM (`kdur`): **3** (0 exact / 3 artist) |
| 327 | Glove | **3** | 0 | 3 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (0 exact / 3 artist) |
| 328 | GRATEFUL DEAD | **3** | 0 | 3 | East Tennessee's Own WDVX 89.9 FM (`east-tennessee-s-own-wdvx-89-9-fm`): **1** (0 exact / 1 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 329 | In Flames | **3** | 0 | 3 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (0 exact / 3 artist) |
| 330 | Kadavar | **3** | 0 | 3 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (0 exact / 3 artist) |
| 331 | Loathe | **3** | 1 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (1 exact / 1 artist)<br>KZSC 88.1 FM (`kzsc`): **1** (0 exact / 1 artist) |
| 332 | Lorenzo Senni | **3** | 0 | 3 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (0 exact / 3 artist) |
| 333 | Madlib | **3** | 3 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist)<br>WBEZ-HD2 "Vocalo Stream" Chicago, IL (`wbez-hd2-vocalo-stream-chicago-il`): **1** (1 exact / 0 artist)<br>WEFT 90.1 FM (`weft`): **1** (1 exact / 0 artist) |
| 334 | Mdou Moctar | **3** | 3 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (3 exact / 0 artist) |
| 335 | Molly Tuttle | **3** | 0 | 3 | East Tennessee's Own WDVX 89.9 FM (`east-tennessee-s-own-wdvx-89-9-fm`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>WEFT 90.1 FM (`weft`): **1** (0 exact / 1 artist) |
| 336 | Noonday Underground | **3** | 1 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (1 exact / 2 artist) |
| 337 | Pile | **3** | 1 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (1 exact / 2 artist) |
| 338 | REM | **3** | 0 | 3 | Radio Mela (`radio-mela`): **2** (0 exact / 2 artist)<br>Pro-Radio (`pro-radio`): **1** (0 exact / 1 artist) |
| 339 | Robert Palmer | **3** | 3 | 0 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (1 exact / 0 artist)<br>Radio Mela (`radio-mela`): **1** (1 exact / 0 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (1 exact / 0 artist) |
| 340 | Rollins Band | **3** | 0 | 3 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (0 exact / 3 artist) |
| 341 | Shed | **3** | 0 | 3 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist)<br>Systrum Sistum - SSR2 (`systrum-sistum-ssr2`): **1** (0 exact / 1 artist) |
| 342 | Soft Kill | **3** | 0 | 3 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (0 exact / 3 artist) |
| 343 | Steve Miller Band | **3** | 0 | 3 | Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **2** (0 exact / 2 artist)<br>RadioActive (`radioactive`): **1** (0 exact / 1 artist) |
| 344 | T REX | **3** | 3 | 0 | FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (1 exact / 0 artist)<br>Radio FM (`radio-fm`): **1** (1 exact / 0 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (1 exact / 0 artist) |
| 345 | T-Rex | **3** | 0 | 3 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (0 exact / 1 artist) |
| 346 | TEARS FOR FEARS | **3** | 0 | 3 | Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **2** (0 exact / 2 artist)<br>Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist) |
| 347 | TEMPLES | **3** | 3 | 0 | Radio FM (`radio-fm`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist)<br>WORT 89.9 FM (`wort`): **1** (1 exact / 0 artist) |
| 348 | The Blackbyrds | **3** | 3 | 0 | C Lab (`c-lab`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist)<br>WSUM 91.7 FM (`wsum`): **1** (1 exact / 0 artist) |
| 349 | The Budos Band | **3** | 3 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (3 exact / 0 artist) |
| 350 | The City Gates | **3** | 0 | 3 | 6forty Radio (`6forty-radio`): **2** (0 exact / 2 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 351 | The Psychedelic Furs | **3** | 3 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (2 exact / 0 artist)<br>WLUR 91.5 FM (`wlur`): **1** (1 exact / 0 artist) |
| 352 | The Psychic Paramount | **3** | 0 | 3 | 6forty Radio (`6forty-radio`): **3** (0 exact / 3 artist) |
| 353 | The Wallflowers | **3** | 0 | 3 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist)<br>WLUR 91.5 FM (`wlur`): **1** (0 exact / 1 artist) |
| 354 | THE WATERBOYS | **3** | 3 | 0 | Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (1 exact / 0 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (1 exact / 0 artist)<br>WCBN 88.3 FM (`wcbn`): **1** (1 exact / 0 artist) |
| 355 | Thundercat | **3** | 1 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (1 exact / 1 artist)<br>Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist) |
| 356 | Tiffany | **3** | 0 | 3 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **2** (0 exact / 2 artist)<br>Lolli Radio Happy Station (`lolli-radio-happy-station`): **1** (0 exact / 1 artist) |
| 357 | Tomahawk | **3** | 0 | 3 | KFAI 90.3 FM (`kfai`): **1** (0 exact / 1 artist)<br>SomaFM Black Rock FM (128k AAC Non-SSL) (`somafm-black-rock-fm-128k-aac-non-ssl`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 358 | Trex | **3** | 0 | 3 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (0 exact / 3 artist) |
| 359 | UFO | **3** | 0 | 3 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **3** (0 exact / 3 artist) |
| 360 | Vieux Farka Touré & Khruangbin | **3** | 3 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (2 exact / 0 artist)<br>KZSC 88.1 FM (`kzsc`): **1** (1 exact / 0 artist) |
| 361 | A Perfect Circle | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist) |
| 362 | Abul Mogard | **2** | 1 | 1 | dinamo.fm smog (`dinamo-fm-smog`): **1** (0 exact / 1 artist)<br>KFAI 90.3 FM (`kfai`): **1** (1 exact / 0 artist) |
| 363 | Agriculture | **2** | 2 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist)<br>WUML 91.5 FM (`wuml`): **1** (1 exact / 0 artist) |
| 364 | ALL THEM WITCHES | **2** | 0 | 2 | Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 365 | Amtrac | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist) |
| 366 | Anthony Moore | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist) |
| 367 | ARC DE SOLEIL | **2** | 2 | 0 | C Lab (`c-lab`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 368 | Automatic | **2** | 2 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (2 exact / 0 artist) |
| 369 | björk | **2** | 0 | 2 | Experimental/Avant-garde music - Radio Caprice (`experimental-avant-garde-music-radio-caprice`): **1** (0 exact / 1 artist)<br>KZSC 88.1 FM (`kzsc`): **1** (0 exact / 1 artist) |
| 370 | Blackwater Holylight | **2** | 2 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (2 exact / 0 artist) |
| 371 | Bruce Hornsby and the Range | **2** | 0 | 2 | Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 372 | Cannons | **2** | 2 | 0 | Synthradio (`synthradio`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 373 | Car Seat Headrest | **2** | 2 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (2 exact / 0 artist) |
| 374 | Carrellee | **2** | 1 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (1 exact / 1 artist) |
| 375 | Cheekface | **2** | 2 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (2 exact / 0 artist) |
| 376 | Cinnamon Chasers | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist) |
| 377 | Cobra Man | **2** | 2 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (2 exact / 0 artist) |
| 378 | Coheed and Cambria | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>WKNC 88.1 FM (`wknc`): **1** (0 exact / 1 artist) |
| 379 | Colour Haze | **2** | 1 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (1 exact / 1 artist) |
| 380 | CREEDENCE CLEARWATER REVIVAL | **2** | 2 | 0 | KTUH 90.3 FM (`ktuh`): **1** (1 exact / 0 artist)<br>Tukker FM (`tukker-fm`): **1** (1 exact / 0 artist) |
| 381 | death’s dynamic shroud | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist) |
| 382 | Desmond Cheese | **2** | 0 | 2 | Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 383 | Destroyer | **2** | 2 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (2 exact / 0 artist) |
| 384 | DIRTY PROJECTORS | **2** | 0 | 2 | Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 385 | Dozer | **2** | 1 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (1 exact / 1 artist) |
| 386 | Dry Cleaning | **2** | 2 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist)<br>WLUR 91.5 FM (`wlur`): **1** (1 exact / 0 artist) |
| 387 | Ecce Shnak | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (0 exact / 1 artist) |
| 388 | Eighth Wonder | **2** | 0 | 2 | Radio Mela (`radio-mela`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 389 | Eloy | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist) |
| 390 | Father John Misty | **2** | 2 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (1 exact / 0 artist) |
| 391 | Fiction Factory | **2** | 2 | 0 | Rovinj FM (`rovinj-fm`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 392 | FLOATING POINTS | **2** | 0 | 2 | Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 393 | Glaare | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist) |
| 394 | Hank Williams III | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist) |
| 395 | HEART | **2** | 0 | 2 | Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist)<br>WSUM 91.7 FM (`wsum`): **1** (0 exact / 1 artist) |
| 396 | HOLY FAWN | **2** | 0 | 2 | 6forty Radio (`6forty-radio`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 397 | Hurray for the Riff Raff | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>WLUR 91.5 FM (`wlur`): **1** (0 exact / 1 artist) |
| 398 | Ibrahim Maalouf | **2** | 2 | 0 | SomaFM Sonic Universe (128k AAC) (`somafm-sonic-universe-128k-aac`): **1** (1 exact / 0 artist)<br>SomaFM Sonic Universe (128k MP3) (`somafm-sonic-universe-128k-mp3`): **1** (1 exact / 0 artist) |
| 399 | ICEAGE | **2** | 0 | 2 | Radio FM (`radio-fm`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 400 | Iggy Pop & James Williamson | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist) |
| 401 | Jack Black | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist) |
| 402 | James Brown | **2** | 2 | 0 | KFAI 90.3 FM (`kfai`): **1** (1 exact / 0 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (1 exact / 0 artist) |
| 403 | Janis Joplin | **2** | 2 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (2 exact / 0 artist) |
| 404 | Jefferson Airplane | **2** | 2 | 0 | Radio SAR - Studencka Agencja Radiowa (`radio-sar-studencka-agencja-radiowa`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 405 | Joe Jackson | **2** | 2 | 0 | Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 406 | Karen Young | **2** | 0 | 2 | Art Of Music (`art-of-music`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 407 | KHRUANGBIN | **2** | 0 | 2 | C Lab (`c-lab`): **2** (0 exact / 2 artist) |
| 408 | Kodomo | **2** | 0 | 2 | SomaFM Black Rock FM (128k AAC Non-SSL) (`somafm-black-rock-fm-128k-aac-non-ssl`): **2** (0 exact / 2 artist) |
| 409 | KRAFTWERK | **2** | 0 | 2 | Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 410 | Lakeside | **2** | 2 | 0 | KFAI 90.3 FM (`kfai`): **1** (1 exact / 0 artist)<br>WCBN 88.3 FM (`wcbn`): **1** (1 exact / 0 artist) |
| 411 | Looking Glass | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist) |
| 412 | Love | **2** | 2 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (2 exact / 0 artist) |
| 413 | LVL UP | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist) |
| 414 | Magic City Hippies | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist) |
| 415 | Margo Price | **2** | 2 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (2 exact / 0 artist) |
| 416 | Marlon Williams | **2** | 1 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist)<br>WDCE 90.1 FM (`wdce`): **1** (0 exact / 1 artist) |
| 417 | MAXWELL | **2** | 0 | 2 | Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (0 exact / 1 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 418 | MEGA BOG | **2** | 2 | 0 | Radio FM (`radio-fm`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 419 | Men I Trust | **2** | 2 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 7df719e1 (`test-acm-human-7df719e1`): **1** (1 exact / 0 artist) |
| 420 | MENAHAN STREET BAND | **2** | 2 | 0 | Le Bon Mix HiFi Flac 1411 Kbps (`le-bon-mix-hifi-flac-1411-kbps`): **1** (1 exact / 0 artist)<br>Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (1 exact / 0 artist) |
| 421 | Miike Snow | **2** | 2 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist)<br>WCFM 91.9 FM (`wcfm`): **1** (1 exact / 0 artist) |
| 422 | Mildlife | **2** | 2 | 0 | Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 423 | Mondo Drag | **2** | 1 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (1 exact / 1 artist) |
| 424 | MORRISSEY | **2** | 0 | 2 | Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **2** (0 exact / 2 artist) |
| 425 | Nala Sinephro | **2** | 2 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist)<br>WEFT 90.1 FM (`weft`): **1** (1 exact / 0 artist) |
| 426 | Nathan Micay | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist) |
| 427 | Nilüfer Yanya | **2** | 1 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>WDCE 90.1 FM (`wdce`): **1** (1 exact / 0 artist) |
| 428 | Orchid | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>WSUM 91.7 FM (`wsum`): **1** (0 exact / 1 artist) |
| 429 | Palm | **2** | 2 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (2 exact / 0 artist) |
| 430 | Patsy Cline | **2** | 0 | 2 | FIP CE False 3e09222d (`test-fip-ce-3e09222d`): **1** (0 exact / 1 artist)<br>KFAI 90.3 FM (`kfai`): **1** (0 exact / 1 artist) |
| 431 | Paul Banks | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist) |
| 432 | Pete Townshend | **2** | 2 | 0 | Nostalgie New York (`nostalgie-new-york`): **1** (1 exact / 0 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (1 exact / 0 artist) |
| 433 | Peter Schilling | **2** | 1 | 1 | Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (1 exact / 0 artist)<br>PANORAMA80 (`panorama80`): **1** (0 exact / 1 artist) |
| 434 | PHIL COLLINS | **2** | 0 | 2 | Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>SLOBODNÝ VYSIELAČ (`slobodn-vysiela`): **1** (0 exact / 1 artist) |
| 435 | Pixies | **2** | 2 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (1 exact / 0 artist) |
| 436 | Police | **2** | 2 | 0 | Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (1 exact / 0 artist)<br>RadioActive (`radioactive`): **1** (1 exact / 0 artist) |
| 437 | PRINCE | **2** | 0 | 2 | Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 438 | Public Image LTD. | **2** | 2 | 0 | Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 439 | Righteous Brothers | **2** | 0 | 2 | Nostalgie New York (`nostalgie-new-york`): **1** (0 exact / 1 artist)<br>Rovinj FM (`rovinj-fm`): **1** (0 exact / 1 artist) |
| 440 | Robin Trower | **2** | 0 | 2 | Grolloo Radio (`grolloo-radio`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 441 | Serpent Column | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist) |
| 442 | Shabazz Palaces feat. Thaddillac | **2** | 2 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist)<br>WBEZ-HD2 "Vocalo Stream" Chicago, IL (`wbez-hd2-vocalo-stream-chicago-il`): **1** (1 exact / 0 artist) |
| 443 | Slow Crush | **2** | 2 | 0 | KTUH 90.3 FM (`ktuh`): **1** (1 exact / 0 artist)<br>WCFM 91.9 FM (`wcfm`): **1** (1 exact / 0 artist) |
| 444 | Temples | **2** | 2 | 0 | Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 445 | The Band with Joni Mitchell | **2** | 2 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (2 exact / 0 artist) |
| 446 | The Breeders | **2** | 2 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (2 exact / 0 artist) |
| 447 | The Brothers Johnson | **2** | 2 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist)<br>WORT 89.9 FM (`wort`): **1** (1 exact / 0 artist) |
| 448 | THE CACTUS CHANNEL | **2** | 2 | 0 | C Lab (`c-lab`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 449 | The Grateful Dead | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist) |
| 450 | The Meters | **2** | 2 | 0 | Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 451 | The Observers | **2** | 0 | 2 | shirley & spinoza (`shirley-spinoza`): **1** (0 exact / 1 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 452 | The Red Hot Chili Peppers | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist) |
| 453 | The Three Suns | **2** | 0 | 2 | shirley & spinoza (`shirley-spinoza`): **1** (0 exact / 1 artist)<br>SRF Musikwelle (`srf-musikwelle`): **1** (0 exact / 1 artist) |
| 454 | The War on Drugs | **2** | 2 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist)<br>WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (1 exact / 0 artist) |
| 455 | Tokimonsta | **2** | 0 | 2 | Experimental/Avant-garde music - Radio Caprice (`experimental-avant-garde-music-radio-caprice`): **2** (0 exact / 2 artist) |
| 456 | Tom Petty | **2** | 2 | 0 | Omroep Zeeland Radio (`omroep-zeeland-radio`): **1** (1 exact / 0 artist)<br>Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 457 | Tomasz Bednarczyk | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist) |
| 458 | Townes Van Zandt | **2** | 2 | 0 | SomaFM Boot Liquor (128k AAC) (`somafm-boot-liquor-128k-aac`): **1** (1 exact / 0 artist)<br>SomaFM Boot Liquor (320k MP3) (`somafm-boot-liquor-320k-mp3`): **1** (1 exact / 0 artist) |
| 459 | Truckfighters | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist) |
| 460 | Unto Others | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (0 exact / 2 artist) |
| 461 | Urban Heat | **2** | 0 | 2 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist)<br>WRIR 97.3 FM (`wrir`): **1** (0 exact / 1 artist) |
| 462 | When In Rome | **2** | 2 | 0 | Big R Radio - The Wave (`big-r-radio-the-wave`): **1** (1 exact / 0 artist)<br>Nostalgie New York (`nostalgie-new-york`): **1** (1 exact / 0 artist) |
| 463 | Wucan | **2** | 0 | 2 | Radio Caprice - Krautrock (`radio-caprice-krautrock`): **2** (0 exact / 2 artist) |
| 464 | Yeah Yeah Yeahs | **2** | 2 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (2 exact / 0 artist) |
| 465 | Yves Tumor | **2** | 2 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **2** (2 exact / 0 artist) |
| 466 | (ghost) | **1** | 0 | 1 | dinamo.fm smog (`dinamo-fm-smog`): **1** (0 exact / 1 artist) |
| 467 | 3rd Secret | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 468 | Acid King | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 469 | Admo | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 470 | Alan Parsons Project | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 471 | Alex Henry Foster | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 472 | Allah-Las | **1** | 1 | 0 | RadioActive (`radioactive`): **1** (1 exact / 0 artist) |
| 473 | Amen Dunes | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 474 | AMTRAC | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 475 | Anadol | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 476 | Anna von Hausswolff | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 477 | Aquarium | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 478 | Atlanta Rhythm Section | **1** | 1 | 0 | WLUR 91.5 FM (`wlur`): **1** (1 exact / 0 artist) |
| 479 | Barry Can't Swim | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 480 | Bat for Lashes | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 481 | BJÖRK | **1** | 0 | 1 | Radio FM (`radio-fm`): **1** (0 exact / 1 artist) |
| 482 | Black Country, New Road | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 483 | Black Midi | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 484 | Blue Material | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 485 | Bobb Trimble | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 486 | Bodega | **1** | 1 | 0 | KTUH 90.3 FM (`ktuh`): **1** (1 exact / 0 artist) |
| 487 | Bootsy Collins | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 488 | Boris | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 489 | Brenton Wood | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 490 | Bruce Hornsby | **1** | 0 | 1 | Radio Mela (`radio-mela`): **1** (0 exact / 1 artist) |
| 491 | Caterina Barbieri | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 492 | Catherine Wheel | **1** | 1 | 0 | DKFM Classic (`dkfm-classic`): **1** (1 exact / 0 artist) |
| 493 | Charlotte Adigery, Bolis Pupul | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 494 | CHRIS CORNELL | **1** | 1 | 0 | Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (1 exact / 0 artist) |
| 495 | Chromeo feat. Solange | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 496 | Cola | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 497 | Color Green | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 498 | Colour Box | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 499 | Crumb | **1** | 1 | 0 | KDUR 91.9 FM (`kdur`): **1** (1 exact / 0 artist) |
| 500 | Cuffed Up | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 501 | Cyndi Lauper | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 502 | Daikaiju | **1** | 0 | 1 | KFAI 90.3 FM (`kfai`): **1** (0 exact / 1 artist) |
| 503 | Damien Jurado | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 504 | Dan Deacon | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 505 | Dan Mason ダン·メイソン | **1** | 0 | 1 | WRIR 97.3 FM (`wrir`): **1** (0 exact / 1 artist) |
| 506 | Daniel Rossen | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 507 | Darkside | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 508 | Daryl Hall + John Oates | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 509 | DAVID GILMOUR | **1** | 1 | 0 | Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (1 exact / 0 artist) |
| 510 | Death Valley Girls | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 511 | Devon Church | **1** | 0 | 1 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist) |
| 512 | Doom Gong | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 513 | DOVS | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 514 | Drug Church | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 515 | DURAN DURAN | **1** | 0 | 1 | Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 516 | Duskus | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 517 | Earth, Wind & Fire | **1** | 1 | 0 | Radio Armisa (`radio-armisa`): **1** (1 exact / 0 artist) |
| 518 | Electric Citizen | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 519 | Electric Wizard | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 520 | Elton John | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 521 | EMPIRE OF THE SUN | **1** | 0 | 1 | Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist) |
| 522 | Empire Of The Sun | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 523 | EURYTHMICS | **1** | 0 | 1 | Radio FM (`radio-fm`): **1** (0 exact / 1 artist) |
| 524 | Everything Everything | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 525 | Far | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 526 | FOO FIGHTERS | **1** | 0 | 1 | Rockserwis.fm (`rockserwis-fm`): **1** (0 exact / 1 artist) |
| 527 | Fred again.. & The Blessed Madonna | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 528 | Fred Williams | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 529 | G. Love | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 530 | Gang Starr | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 531 | Gang Starr feat. Inspectah Deck | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 532 | Gardens & Villa | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 533 | Genesis Owusu | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 534 | Ghost Power | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 535 | Glen Campbell | **1** | 1 | 0 | Tukker FM (`tukker-fm`): **1** (1 exact / 0 artist) |
| 536 | Goldfrapp | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 537 | Gong Gong Gong | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 538 | GRAHAM NASH | **1** | 0 | 1 | Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 539 | Greensky Bluegrass | **1** | 0 | 1 | WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 540 | GUNSHIP | **1** | 0 | 1 | Synthradio (`synthradio`): **1** (0 exact / 1 artist) |
| 541 | H.P. Lovecraft | **1** | 1 | 0 | KZSC 88.1 FM (`kzsc`): **1** (1 exact / 0 artist) |
| 542 | Herbie Hancock | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 543 | Hiatus Kaiyote | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 544 | Holy Fuck | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 545 | Holy Fuck feat. Alexis Taylor | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 546 | Hot Chip | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 547 | Hotline TNT | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 548 | Ian Matthews | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 549 | iceage | **1** | 0 | 1 | WRBB 104.9 FM (`wrbb`): **1** (0 exact / 1 artist) |
| 550 | Israel Nash | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 551 | James Holden | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 552 | Janko Nilovic | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 553 | Jonathan Wilson | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 554 | Just Mustard | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 555 | Kali Malone | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 556 | Kavinsky | **1** | 1 | 0 | Synthradio (`synthradio`): **1** (1 exact / 0 artist) |
| 557 | King Buffalo | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 558 | Kit Sebastian | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 559 | Kylie Minogue | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 560 | LCD Soundsystem | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 561 | LI YILEI | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 562 | Lilacs & Champagne | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 563 | Little Murders | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 564 | Lumerians | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 565 | M83 | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 566 | Magdalena Bay | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 567 | Mareux | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 568 | Martha Skye Murphy | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 569 | Mastodon | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 570 | Maya Shenfeld | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 571 | Michael Kiwanuka | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 572 | Midnight Oil | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 573 | Mike & Rich | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 574 | Million Moons | **1** | 0 | 1 | 6forty Radio (`6forty-radio`): **1** (0 exact / 1 artist) |
| 575 | Misha Panfilov | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 576 | Moon Duo | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 577 | Moses Gunn Collective | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 578 | Mountain | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 579 | Mountain Witch | **1** | 0 | 1 | KFAI 90.3 FM (`kfai`): **1** (0 exact / 1 artist) |
| 580 | Mulatu Astatqé | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 581 | NANCY SINATRA | **1** | 0 | 1 | SRF Musikwelle (`srf-musikwelle`): **1** (0 exact / 1 artist) |
| 582 | Natalie Cole | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 583 | Naxatras | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 584 | Neu! | **1** | 1 | 0 | Radio Caprice - Krautrock (`radio-caprice-krautrock`): **1** (1 exact / 0 artist) |
| 585 | Nick Gilder | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 586 | Nico Georis | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 587 | Nicolas Godin feat. Cola Boyy | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 588 | Noura Mint Seymali | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 589 | ODESZA feat. Briana Marela | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 590 | ODESZA feat. Jenni Potts | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 591 | ODESZA feat. Madelyn Grant | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 592 | ODESZA feat. Shy Girls | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 593 | Oh Sees | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 594 | Orions Belte | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 595 | Parquet Courts | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 596 | Party Dozen | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 597 | Pavel Milyakov | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 598 | Peter GABRIEL | **1** | 0 | 1 | Radio FM (`radio-fm`): **1** (0 exact / 1 artist) |
| 599 | Petrol Girls | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 600 | PinkPantheress | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 601 | Pjusk | **1** | 0 | 1 | Experimental/Avant-garde music - Radio Caprice (`experimental-avant-garde-music-radio-caprice`): **1** (0 exact / 1 artist) |
| 602 | Preoccupations | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 603 | Project Gemini | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 604 | Purple Mountains | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 605 | QUEEN | **1** | 0 | 1 | Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist) |
| 606 | R.I.P. | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 607 | Replacements | **1** | 0 | 1 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (0 exact / 1 artist) |
| 608 | Rudy Norman | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 609 | Rufus featuring Chaka Khan | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 610 | Rufus, Chaka Khan | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 611 | Saidan | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 612 | Salem | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 613 | SAULT | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 614 | Savatage | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 615 | Sex Blender | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 616 | Shabazz Palaces | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 617 | Sharon Van Etten | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 618 | Sheer Mag | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 619 | Sigur Ros | **1** | 1 | 0 | Radio Caprice - Post-rock (`radio-caprice-post-rock`): **1** (1 exact / 0 artist) |
| 620 | Silver Apples | **1** | 1 | 0 | WEFT 90.1 FM (`weft`): **1** (1 exact / 0 artist) |
| 621 | Slint | **1** | 1 | 0 | WRBB 104.9 FM (`wrbb`): **1** (1 exact / 0 artist) |
| 622 | Slomosa | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 623 | Slowly Rolling Camera | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 624 | snuggle | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 625 | SPEED, GLUE & SHINKI | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 626 | Spiral Drive | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 627 | Stevie Wonder | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 628 | Still Ruins | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 629 | Superheaven | **1** | 0 | 1 | WUML 91.5 FM (`wuml`): **1** (0 exact / 1 artist) |
| 630 | Susumu Yokota | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 631 | Sword | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 632 | T.S.O.L. | **1** | 1 | 0 | WRBB 104.9 FM (`wrbb`): **1** (1 exact / 0 artist) |
| 633 | Terry Reid | **1** | 0 | 1 | WCBN 88.3 FM (`wcbn`): **1** (0 exact / 1 artist) |
| 634 | The  Black Angels | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 635 | The Band and The Staple Singers | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 636 | The Band with Dr. John | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 637 | The Band with Muddy Waters | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 638 | The Band with Orchestra | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 639 | THE BOBBY LEES | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 640 | The Body | **1** | 0 | 1 | DJ 666 Geordieblackcore (`dj-666-geordieblackcore`): **1** (0 exact / 1 artist) |
| 641 | The Comet Is Coming | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 642 | The Creatures | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 643 | The Dean Ween Group | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 644 | THE DIVINE COMEDY | **1** | 0 | 1 | Radyo A (Radyo Anadolu Üniversitesi) (`radyo-a-radyo-anadolu-niversitesi`): **1** (0 exact / 1 artist) |
| 645 | The Eagles | **1** | 0 | 1 | WXPN 88.5 Philadelphia, PA (`wxpn-88-5-philadelphia-pa`): **1** (0 exact / 1 artist) |
| 646 | The Gaslight Anthem | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 647 | The Human League | **1** | 1 | 0 | WLUR 91.5 FM (`wlur`): **1** (1 exact / 0 artist) |
| 648 | The James Gang | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 649 | The Knife | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 650 | The London Suede | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 651 | The Righteous Brothers | **1** | 0 | 1 | Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 652 | The Smile | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 653 | THE SMITHS | **1** | 0 | 1 | Radio FM (`radio-fm`): **1** (0 exact / 1 artist) |
| 654 | The Soft Pink Truth | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 655 | The Temptations | **1** | 1 | 0 | KPISS (`rb-56241b49-2f23-4266-bdad-f4ad9a41ee24`): **1** (1 exact / 0 artist) |
| 656 | The Thievery Corporation | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 657 | The Toxic Avenger | **1** | 0 | 1 | Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (0 exact / 1 artist) |
| 658 | The Voidz | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 659 | The Woods | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 660 | Theon Cross | **1** | 1 | 0 | WEFT 90.1 FM (`weft`): **1** (1 exact / 0 artist) |
| 661 | TOBACCO | **1** | 1 | 0 | Radio FM (`radio-fm`): **1** (1 exact / 0 artist) |
| 662 | Toe | **1** | 0 | 1 | WRBB 104.9 FM (`wrbb`): **1** (0 exact / 1 artist) |
| 663 | Tom Petty and the Heartbreakers | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 664 | Tomaga | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 665 | Top Drawer | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 666 | Tortoise | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 667 | TR/ST | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 668 | Trans Am | **1** | 0 | 1 | WEFT 90.1 FM (`weft`): **1** (0 exact / 1 artist) |
| 669 | Traveling Wilburys | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 670 | Tropical Fuck Storm | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 671 | True Loves | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 672 | U.F.O. | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 673 | U.S. Girls | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 674 | Van Morrison | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 675 | Waveshaper | **1** | 0 | 1 | Nightride FM - Datawave (`nightride-fm-datawave`): **1** (0 exact / 1 artist) |
| 676 | Wax Machine | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 677 | Weezer | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 678 | Whale | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 679 | Will Van Horn | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 680 | WITCH | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 681 | Wolf People | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 682 | Wombo | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 683 | Yaeji feat. Nappy Nina | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 684 | YES | **1** | 1 | 0 | Le Bon Mix Radio 97.9 (`le-bon-mix-radio-97-9`): **1** (1 exact / 0 artist) |
| 685 | YIN YIN | **1** | 0 | 1 | C Lab (`c-lab`): **1** (0 exact / 1 artist) |
| 686 | Yo La Tengo | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 687 | Yot Club | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 688 | Yumi Zouma | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |
| 689 | Yusuf / Cat Stevens | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 690 | ZOMBI | **1** | 0 | 1 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (0 exact / 1 artist) |
| 691 | Σtella | **1** | 1 | 0 | Test AutoClass Human 3aca5e96 (`test-acm-human-3aca5e96`): **1** (1 exact / 0 artist) |

