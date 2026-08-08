# Lore Station Roster Audit — R0 Gate Report

**Audit timestamp:** 2026-08-08T14:58:50 UTC  
**Database time basis:** PostgreSQL `now()` = `2026-08-08 14:58:50.416658+00`  
**Database:** `heliumdb` (development)  
**Scope:** All non-test station rows; `hidden=false` enforced for public-facing counts.  
**Read-only:** No data, schema, or flags modified.

---

## 1. Roster Freeze

### 1a. Overall composition (excluding test rows)

| Segment | Source | Tier | Active | Hidden | Source type | Count |
|---|---|---|---|---|---|---|
| Curated Spinitron stations | curated | flagship | ✓ | — | spinitron_web | 78 |
| Curated FIP channels | curated | flagship | ✓ | — | fip | 8 |
| Curated ICY (community) | curated | flagship | ✓ | — | radio_browser_icy | 6 |
| Curated no-source (CA stations) | curated | flagship | ✓ | — | *(none)* | 3 |
| Curated NTS | curated | flagship | ✓ | — | nts_live | 2 |
| Curated KEXP | curated | flagship | ✓ | — | kexp_api | 1 |
| Curated BBC 6Music | curated | flagship | ✓ | — | bbc_api | 1 |
| Curated The Lot Radio | curated | flagship | ✓ | — | lot_radio_schedule | 1 |
| Curated KCRW | curated | flagship | ✓ | — | kcrw | 1 |
| Curated Rinse FM (inactive) | curated | flagship | — | — | *(none)* | 1 |
| **Curated SomaFM (hidden)** | curated | flagship | ✓ | **hidden** | somafm | 15 |
| **Curated Radio Paradise (hidden)** | curated | flagship | ✓ | **hidden** | radio_paradise | 4 |
| Curated longtail (mixed) | curated | longtail | mixed | — | mixed | 3 |
| radio_browser longtail — active visible | radio_browser | longtail | ✓ | — | radio_browser_icy | 405 |
| radio_browser longtail — inactive | radio_browser | longtail | — | — | radio_browser_icy | 240 |
| radio_browser longtail — active hidden | radio_browser | longtail | ✓ | hidden | radio_browser_icy | 23 |

**Total non-test rows:** ~797  
**Publicly visible (active=true, hidden=false):** ~507  
**Curated active+visible flagships:** ~103  

### 1b. Origin classification

- **Source = 'curated'**: Hand-curated and embedded-list Spinitron stations. All have `tier = 'flagship'` (never auto-demoted). College radio spinitron_web rows were seeded via `seedSpinitronRoster()` using the `EMBEDDED_SPINITRON_STATIONS` fallback (84 stations) because both the Spinitron API (requires `SPINITRON_API_KEY`) and HTML directory (returned 404 at boot) were unavailable.
- **Source = 'radio_browser'**: Auto-discovered via radio-browser.info. Longtail tier; auto-demoted to `active=false` after 3 health failures.
- **No SPINITRON_API_KEY is set** in this environment; no `SPINITRON_KEY_*` per-station keys are set. All Spinitron stations use the unauthenticated `spinitron_web` adapter.

---

## 2. Volume Report (7-day and 30-day)

**Metric definitions:**
- **raw_7d / raw_30d**: Count of `spins` rows with `played_at` within the window (raw rows, one per detected play change; includes unresolved tracks).
- **resolved_7d / resolved_30d**: Count where `spins.mbid IS NOT NULL`.
- **distinct_mbids_7d / _30d**: Count of `DISTINCT spins.mbid` where non-null (spine entries reached).
- **unresolved_7d**: `raw - resolved` (no MBID matched via MB/ISRC/Spotify).
- **resolve_rate_pct**: `resolved / raw × 100`.
- **latest_played_at**: `MAX(played_at)` across all time.

### Table 2a — Curated flagship stations (active, not hidden), sorted by 7-day raw volume

| Station | Slug | Source | 7d raw | 7d resolved | 7d distinct MBIDs | 7d unresolved | 7d resolve% | 30d raw | 30d resolved | 30d distinct MBIDs | Latest play (UTC) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| KEXP | kexp | kexp_api | 906 | 876 | 793 | 30 | 96.7% | 5992 | 5492 | 4403 | 2026-08-08 |
| WRBB | wrbb | spinitron_web | 407 | 326 | 188 | 81 | 80.1% | 1003 | 792 | 318 | 2026-08-08 |
| WUOG | wuog | spinitron_web | 381 | 268 | 15 | 113 | 70.3% | 571 | 380 | 79 | 2026-08-08 |
| WLUR | wlur | spinitron_web | 349 | 285 | 244 | 64 | 81.7% | 1169 | 957 | 557 | 2026-08-08 |
| WRAS | wras | spinitron_web | 205 | 152 | 104 | 53 | 74.1% | 425 | 300 | 140 | 2026-08-08 |
| WMFO | wmfo | spinitron_web | 181 | 128 | 105 | 53 | 70.7% | 467 | 312 | 231 | 2026-08-08 |
| KVSC | kvsc | spinitron_web | 165 | 129 | 119 | 36 | 78.2% | 381 | 310 | 256 | 2026-08-08 |
| WBRS | wbrs | spinitron_web | 162 | 30 | 11 | 132 | 18.5% | 631 | 347 | 305 | 2026-08-08 |
| KCRW Eclectic24 | kcrw-eclectic24 | kcrw | 124 | 65 | 51 | 59 | 52.4% | 938 | 577 | 354 | 2026-08-08 |
| WZBC | wzbc | spinitron_web | 110 | 76 | 75 | 34 | 69.1% | 348 | 228 | 224 | 2026-08-08 |
| KALX | kalx | spinitron_web | 94 | 69 | 69 | 25 | 73.4% | 335 | 227 | 218 | 2026-08-08 |
| KTUH | ktuh | spinitron_web | 74 | 40 | 40 | 34 | 54.1% | 577 | 361 | 353 | 2026-08-08 |
| KXLU | kxlu | spinitron_web | 86 | 56 | 55 | 30 | 65.1% | 358 | 238 | 223 | 2026-08-08 |
| KDVS | kdvs | spinitron_web | 49 | 29 | 28 | 20 | 59.2% | 219 | 143 | 138 | 2026-08-08 |
| WHRB | whrb | spinitron_web | 58 | 17 | 17 | 41 | 29.3% | 185 | 79 | 77 | 2026-08-08 |
| WKCR | wkcr | spinitron_web | 58 | 28 | 25 | 30 | 48.3% | 189 | 103 | 98 | 2026-08-08 |
| WUML | wuml | spinitron_web | 136 | 118 | 91 | 18 | 86.8% | 478 | 395 | 279 | 2026-08-08 |
| WKNC | wknc | spinitron_web | 65 | 51 | 50 | 14 | 78.5% | 286 | 206 | 193 | 2026-08-08 |
| WDCE | wdce | spinitron_web | 114 | 75 | 73 | 39 | 65.8% | 365 | 255 | 226 | 2026-08-08 |
| KCSB | kcsb | spinitron_web | 103 | 46 | 43 | 57 | 44.7% | 321 | 169 | 150 | 2026-08-08 |
| KAOS | kaos | spinitron_web | 59 | 30 | 29 | 29 | 50.8% | 399 | 237 | 214 | 2026-08-08 |
| KZSC | kzsc | spinitron_web | 58 | 44 | 42 | 14 | 75.9% | 402 | 274 | 266 | 2026-08-08 |
| KSJS | ksjs | spinitron_web | 58 | 31 | 28 | 27 | 53.4% | 274 | 140 | 124 | 2026-08-08 |
| WPRB | wprb | spinitron_web | 77 | 45 | 41 | 32 | 58.4% | 287 | 163 | 155 | 2026-08-08 |
| WCBN | wcbn | spinitron_web | 68 | 32 | 32 | 36 | 47.1% | 497 | 234 | 233 | 2026-08-08 |
| WORT | wort | spinitron_web | 71 | 36 | 34 | 35 | 50.7% | 425 | 235 | 216 | 2026-08-08 |
| WSUM | wsum | spinitron_web | 110 | 73 | 65 | 37 | 66.4% | 632 | 392 | 349 | 2026-08-08 |
| WEFT | weft | spinitron_web | 56 | 27 | 27 | 29 | 48.2% | 499 | 269 | 251 | 2026-08-08 |
| WLUW | wluw | spinitron_web | 153 | 120 | 90 | 33 | 78.4% | 374 | 275 | 213 | 2026-08-08 |
| KDUR | kdur | spinitron_web | 53 | 28 | 28 | 25 | 52.8% | 171 | 98 | 98 | 2026-08-08 |
| KFAI | kfai | spinitron_web | 60 | 32 | 31 | 28 | 53.3% | 486 | 295 | 284 | 2026-08-08 |
| WCFM | wcfm | spinitron_web | 14 | 10 | 10 | 4 | 71.4% | 66 | 39 | 39 | 2026-08-07 |
| KUCR | kucr | spinitron_web | 7 | 4 | 4 | 3 | 57.1% | 57 | 38 | 38 | 2026-08-07 |
| KXUA | kxua | spinitron_web | 1 | 0 | 0 | 1 | 0% | 1 | 0 | 0 | 2026-07-15 |
| BBC 6Music | bbc-6music | bbc_api | 167 | 119 | 103 | 48 | 71.3% | 935 | 618 | 523 | 2026-08-08 |
| Worldwide FM | worldwide-fm | radio_browser_icy | 176 | 152 | 150 | 24 | 86.4% | 1047 | 508 | 154 | 2026-08-08 |
| Dublab | dublab | radio_browser_icy | 31 | 19 | 19 | 12 | 61.3% | 205 | 45 | 37 | 2026-08-08 |
| The Lot Radio | the-lot-radio | lot_radio_schedule | 52 | 29 | 29 | 23 | 55.8% | 44 | 0 | 0 | 2026-08-08 |
| Refuge Worldwide | refuge-worldwide | radio_browser_icy | 74 | 32 | 31 | 42 | 43.2% | 152 | 4 | 2 | 2026-08-08 |
| CJSR | cjsr | radio_browser_icy | 363 | 136 | 118 | 227 | 37.5% | 412 | 156 | 136 | 2026-08-08 |
| Balamii | balamii | radio_browser_icy | 0 | — | — | — | — | 0 | 0 | 0 | *(never)* |
| CFUV | cfuv | radio_browser_icy | 0 | — | — | — | — | 0 | 0 | 0 | *(never)* |
| CKUT | ckut | radio_browser_icy | 0 | — | — | — | — | 7 | 0 | 0 | 2026-07-17 |
| CHMR | chmr | *(none)* | 0 | — | — | — | — | 0 | 0 | 0 | *(never)* |
| CISM | cism | *(none)* | 0 | — | — | — | — | 0 | 0 | 0 | *(never)* |
| CKCU | ckcu | *(none)* | 0 | — | — | — | — | 0 | 0 | 0 | *(never)* |
| WTBU | wtbu | spinitron_web | 2 | 1 | 1 | 1 | 50% | 5 | 2 | 2 | 2026-08-06 |
| WBAR | wbar | spinitron_web | 0 | — | — | — | — | 1 | 0 | 0 | 2026-07-15 |
| KUPS | kups | spinitron_web | 0 | — | — | — | — | 1 | 0 | 0 | 2026-07-15 |

**Genuinely silent curated stations (0 spins 7d AND 0 spins 30d):**  
WERS, WMWM, WGAM, WRPI, WICB, WITR, WRCU, WRHU, WVOF, WGSU, WBMB, WSBU, WSAM, WPTS, WUVT, WUFT, WVFS, WRGP, WHPK, WMHW, WDET, WUSC, WIUX, WREX, WMTU, KUNM, KUCI, KSDT, KZSU, KCRH, KASC, KUAZ, KMNR, KGRG, KLCC, WNUR, WREK, WFMU, WXYC, KVRX, WMBR, WUSB, WVUM, NTS-1, NTS-2, Rinse FM, Balamii, CFUV, CHMR, CISM, CKCU  
*(51 stations — 7d zero; some have small 30d counts from earlier ingest)*

**Notable anomalies:**
- **WUOG**: 381 spins 7d but only 15 distinct MBIDs — unusually low MBID diversity suggests the station is looping a small catalogue or the spinitron_web adapter is seeing repeated entries.
- **WBRS**: 162 raw spins, only 30 resolved (18.5% resolve rate) — high unresolved fraction suggests unusual metadata (live DJ ad-libs, non-standard formatting).
- **WHRB**: 70% unresolved — Harvard DJ shows tend to play rare/obscure recordings that MusicBrainz doesn't index.
- **KXUA**: Only 1 spin in 30 days — the Spinitron probe returned 200 (valid member) so the adapter reaches the page, but the station appears nearly silent.
- **FIP Metal**: 0 spins in 30d — the feed appears to have stopped producing data.
- **NTS-1 / NTS-2**: 0 spins in 30d — the `nts_live` adapter returns show-level data (broadcast title as rawTitle, host as rawArtist), not per-track data; change-detection triggers only when the show changes. This appears stalled.

### Table 2b — SomaFM channels (hidden from public dial, still polled)

| Channel | 7d raw | 30d raw | 30d resolved | 30d distinct MBIDs |
|---|---|---|---|---|
| Groove Salad | (not queried separately — active) | 1841 | 1284 | 660 |
| Drone Zone | — | 1058 | 609 | 540 |
| Deep Space One | — | 1028 | 617 | 567 |
| Space Station | — | 1189 | 868 | 796 |
| Lush | — | 1811 | 1282 | 939 |
| Indie Pop | — | 1291 | 1030 | 869 |
| Secret Agent | — | 1300 | 881 | 794 |
| The Trip | — | 812 | 366 | 364 |
| Sonic Universe | — | 1319 | 855 | 716 |
| Boot Liquor | — | 1955 | 1355 | 1012 |
| Thistle | — | 1638 | 831 | 548 |
| Folk Fwd | — | 1935 | 1439 | 755 |
| Fluid | — | 1571 | 938 | 706 |
| Suburbs of Goa | — | 1612 | 1051 | 580 |
| PopTron | — | 1475 | 1092 | 854 |

*SomaFM channels are productive (high volume, good resolve rates) but hidden from the public dial. They continue to build the spine.*

---

## 3. Attribution Yield

**Attribution hierarchy (Lore canonical):**
1. **Named eligible picker** — spin has `show_id`, show has `picker_id`, show has a non-empty `dj_name` that passes `eligibleDjName()`.
2. **Resolved show, no eligible picker** — `show_id` set, `mbid` not null, but picker absent or DJ name fails eligibility.
3. **Resolved spin, no show** — `mbid` not null, `show_id` null.
4. **Unresolved spin** — `mbid` null.

**Caveat on `eligibleDjName`:** The audit SQL checks `sh.dj_name IS NOT NULL AND sh.dj_name != ''` rather than calling the full `eligibleDjName()` function (which applies a single-real-name heuristic). Counts in the "named picker" column are a ceiling; actual eligible DJ counts may be lower.

**Key finding:** Zero `spinitron_web` stations have any spins in the "named eligible picker" bucket for the 7-day window. Attribution is entirely in the "resolved spin, no show" or "unresolved spin" categories. This is expected: `spinitron_web` is a now-playing-only adapter with no show/DJ metadata in the current payload. The `scraped_shows` schedule sync creates `shows` rows and `pickers`, but those require `show_id` stamping to flow into spins — which only happens for stations with a known `iana_timezone` and active scraped show slots.

### Table 3 — Attribution yield (7-day) for active curated stations with any spins

| Station | Named picker | Show, no picker | Resolved, no show | Unresolved | Total | automationClass |
|---|---|---|---|---|---|---|
| KEXP | 906 | 0 | 0 | 30 | 906 | human |
| WRBB | 0 | 0 | 326 | 81 | 407 | human |
| WUOG | 0 | 0 | 268 | 113 | 381 | human |
| WLUR | 0 | 0 | 285 | 64 | 349 | human |
| WRAS | 0 | 0 | 152 | 53 | 205 | human |
| WMFO | 0 | 0 | 128 | 53 | 181 | human |
| KVSC | 0 | 0 | 129 | 36 | 165 | human |
| WBRS | 0 | 0 | 30 | 132 | 162 | human |
| KCRW Eclectic24 | 0 | 65 | 0 | 59 | 124 | human |
| WZBC | 0 | 0 | 76 | 34 | 110 | human |
| KALX | 0 | 0 | 69 | 25 | 94 | human |
| KTUH | 0 | 0 | 40 | 34 | 74 | human |
| KXLU | 0 | 0 | 56 | 30 | 86 | human |
| BBC 6Music | 0 | 0 | 119 | 48 | 167 | human |
| CJSR | 0 | 0 | 136 | 227 | 363 | human |
| Worldwide FM | 0 | 0 | 152 | 24 | 176 | mixed |
| Refuge Worldwide | 0 | 0 | 32 | 42 | 74 | *(null)* |
| The Lot Radio | 0 | 0 | 29 | 23 | 52 | human |
| Dublab | 0 | 0 | 19 | 12 | 31 | *(null)* |

**KEXP is the only station with named picker attribution** — the KEXP shows harvester (`kexp_api` source) returns DJ/show data per spin and the shows sync populates `picker_id` on shows rows. All other sources (spinitron_web, radio_browser_icy, etc.) produce zero show attribution in the 7-day window because either: (a) no show slots are stamped, or (b) the adapter doesn't supply show data.

**KCRW** shows `show_no_picker` (65 spins) — it supplies `program_title` + `host` in the adapter response but the shows table entries don't yet have `picker_id` populated.

---

## 4. Spinitron Membership Probe

**Method:** One unauthenticated `GET https://spinitron.com/{CALLSIGN}/` per station, 1.1 s apart, curl with 10 s timeout, follow up to 5 redirects. User-Agent: `LoreRadio-Audit/1.0 (+https://lore.fm/audit)`.  
**Classification:**
- `valid` — HTTP 200 at final URL that is not the Spinitron home/directory.
- `missing` — HTTP 404 at final URL.
- `redirect-to-home` — HTTP 200 but final URL resolved to the Spinitron root or /stations directory.
- `blocked` — HTTP 403 or 429.
- `transient-fail` — curl exit 000 (connection failure, timeout).

**Key-configured:** Whether `SPINITRON_KEY_{CALLSIGN}` is set in this environment. **Answer: none** (`SPINITRON_API_KEY` also absent). All 84 stations use the unauthenticated `spinitron_web` adapter.

**Audio recognition note:** The database does not expose a reliable marker for whether Spinitron uses audio recognition (ACR) for a given station's playlist entries vs. DJ manual logging. The `spinitron_web` adapter returns raw artist/title text from the public playlist page regardless of origin method. This audit **cannot distinguish ACR-filled from DJ-logged** spins from DB evidence alone. Attribution yield (show/picker presence) is a proxy but not proof.

### Table 4 — Spinitron membership for all 84 embedded callsigns

| Callsign | Station name (seed) | Org | In DB | DB slug | HTTP status | Spinitron URL (final) | Classification | Key set | 7d spins (DB) |
|---|---|---|---|---|---|---|---|---|---|
| **WPRB** | WPRB 103.3 FM | Princeton | ✓ | wprb | 200 | spinitron.com/WPRB/ | valid | — | 77 |
| **WNUR** | WNUR 89.3 FM | Northwestern | ✓ | wnur | 404 | spinitron.com/WNUR/ | **missing** | — | 0 |
| **WREK** | WREK 91.1 FM | Georgia Tech | ✓ | wrek | 404 | spinitron.com/WREK/ | **missing** | — | 0 |
| **KDVS** | KDVS 90.3 FM | UC Davis | ✓ | kdvs | 200 | spinitron.com/KDVS/ | valid | — | 49 |
| **WHRB** | WHRB 95.3 FM | Harvard | ✓ | whrb | 200 | spinitron.com/WHRB/ | valid | — | 58 |
| **WKCR** | WKCR 89.9 FM | Columbia | ✓ | wkcr | 200 | spinitron.com/WKCR/ | valid | — | 58 |
| **WFMU** | WFMU 91.1 FM | WFMU | ✓ | wfmu | 404 | spinitron.com/WFMU/ | **missing** | — | 0 |
| **WXYC** | WXYC 89.3 FM | UNC Chapel Hill | ✓ | wxyc | 404 | spinitron.com/WXYC/ | **missing** | — | 0 |
| **KALX** | KALX 90.7 FM | UC Berkeley | ✓ | kalx | 200 | spinitron.com/KALX/ | valid | — | 94 |
| **KVRX** | KVRX 91.7 FM | UT Austin | ✓ | kvrx | 404 | spinitron.com/KVRX/ | **missing** | — | 0 |
| **WMBR** | WMBR 88.1 FM | MIT | ✓ | wmbr | 404 | spinitron.com/WMBR/ | **missing** | — | 0 |
| **WUSB** | WUSB 90.1 FM | Stony Brook | ✓ | wusb | 404 | spinitron.com/WUSB/ | **missing** | — | 0 |
| **WUOG** | WUOG 90.5 FM | UGA | ✓ | wuog | 200 | spinitron.com/WUOG/ | valid | — | 381 |
| **WVUM** | WVUM 90.5 FM | Univ. Miami | ✓ | wvum | 404 | spinitron.com/WVUM/ | **missing** | — | 0 |
| **KVSC** | KVSC 88.1 FM | St. Cloud State | ✓ | kvsc | 200 | spinitron.com/KVSC/ | valid | — | 165 |
| WMFO | WMFO 91.5 FM | Tufts | ✓ | wmfo | 200 | spinitron.com/WMFO/ | valid | — | 181 |
| WERS | WERS 88.9 FM | Emerson | ✓ | wers | 404 | spinitron.com/WERS/ | **missing** | — | 0 |
| WBRS | WBRS 100.1 FM | Brandeis | ✓ | wbrs | 200 | spinitron.com/WBRS/ | valid | — | 162 |
| WZBC | WZBC 90.3 FM | Boston College | ✓ | wzbc | 200 | spinitron.com/WZBC/ | valid | — | 110 |
| WTBU | WTBU 89.3 FM | Boston University | ✓ | wtbu | 200 | spinitron.com/WTBU/ | valid | — | 2 |
| WUML | WUML 91.5 FM | UMass Lowell | ✓ | wuml | 200 | spinitron.com/WUML/ | valid | — | 136 |
| WMWM | WMWM 91.7 FM | Salem State | ✓ | wmwm | 404 | spinitron.com/WMWM/ | **missing** | — | 0 |
| WCFM | WCFM 91.9 FM | Williams | ✓ | wcfm | 200 | spinitron.com/WCFM/ | valid | — | 14 |
| WGAM | WGAM | UNH | ✓ | wgam | 404 | spinitron.com/WGAM/ | **missing** | — | 0 |
| WRPI | WRPI 91.5 FM | RPI | ✓ | wrpi | 404 | spinitron.com/WRPI/ | **missing** | — | 0 |
| WICB | WICB 91.7 FM | Ithaca | ✓ | wicb | 404 | spinitron.com/WICB/ | **missing** | — | 0 |
| WITR | WITR 89.7 FM | RIT | ✓ | witr | 404 | spinitron.com/WITR/ | **missing** | — | 0 |
| WRCU | WRCU 90.1 FM | Colgate | ✓ | wrcu | 404 | spinitron.com/WRCU/ | **missing** | — | 0 |
| WRHU | WRHU 88.7 FM | Hofstra | ✓ | wrhu | 404 | spinitron.com/WRHU/ | **missing** | — | 0 |
| WVOF | WVOF 88.5 FM | Fairfield | ✓ | wvof | 404 | spinitron.com/WVOF/ | **missing** | — | 0 |
| WBAR | WBAR 87.9 FM | Barnard | ✓ | wbar | 200 | spinitron.com/WBAR/ | valid | — | 0 |
| WGSU | WGSU 89.3 FM | SUNY Geneseo | ✓ | wgsu | 404 | spinitron.com/WGSU/ | **missing** | — | 0 |
| WBMB | WBMB 1690 AM | Baruch | ✓ | wbmb | 404 | spinitron.com/WBMB/ | **missing** | — | 0 |
| WSBU | WSBU 88.3 FM | St. Bonaventure | ✓ | wsbu | 404 | spinitron.com/WSBU/ | **missing** | — | 0 |
| WSAM | WSAM | UConn | ✓ | wsam | 404 | spinitron.com/WSAM/ | **missing** | — | 0 |
| WRBB | WRBB 104.9 FM | Northeastern | ✓ | wrbb | 200 | spinitron.com/WRBB/ | valid | — | 407 |
| WPTS | WPTS 92.1 FM | Pittsburgh | ✓ | wpts | 404 | spinitron.com/WPTS/ | **missing** | — | 0 |
| WRAS | WRAS 88.5 FM | Georgia State | ✓ | wras | 200 | spinitron.com/WRAS/ | valid | — | 205 |
| WKNC | WKNC 88.1 FM | NC State | ✓ | wknc | 200 | spinitron.com/WKNC/ | valid | — | 65 |
| WDCE | WDCE 90.1 FM | Richmond | ✓ | wdce | 200 | spinitron.com/WDCE/ | valid | — | 114 |
| WUVT | WUVT 90.7 FM | Virginia Tech | ✓ | wuvt | 404 | spinitron.com/WUVT/ | **missing** | — | 0 |
| WUFT | WUFT 89.1 FM | Univ. Florida | ✓ | wuft | 404 | spinitron.com/WUFT/ | **missing** | — | 0 |
| WVFS | WVFS 89.7 FM | Florida State | ✓ | wvfs | 404 | spinitron.com/WVFS/ | **missing** | — | 0 |
| WRGP | WRGP 88.1 FM | FIU | ✓ | wrgp | 404 | spinitron.com/WRGP/ | **missing** | — | 0 |
| WLUR | WLUR 91.5 FM | Washington & Lee | ✓ | wlur | 200 | spinitron.com/WLUR/ | valid | — | 349 |
| WLUW | WLUW 88.7 FM | Loyola Chicago | ✓ | wluw | 200 | spinitron.com/WLUW/ | valid | — | 153 |
| WHPK | WHPK 88.5 FM | U Chicago | ✓ | whpk | 404 | spinitron.com/WHPK/ | **missing** | — | 0 |
| WEFT | WEFT 90.1 FM | WEFT Community | ✓ | weft | 200 | spinitron.com/WEFT/ | valid | — | 56 |
| WMHW | WMHW 91.5 FM | Central Michigan | ✓ | wmhw | 404 | spinitron.com/WMHW/ | **missing** | — | 0 |
| WCBN | WCBN 88.3 FM | U Michigan | ✓ | wcbn | 200 | spinitron.com/WCBN/ | valid | — | 68 |
| WDET | WDET 101.9 FM | Wayne State | ✓ | wdet | 404 | spinitron.com/WDET/ | **missing** | — | 0 |
| WUSC | WUSC 90.5 FM | USC | ✓ | wusc | 404 | spinitron.com/WUSC/ | **missing** | — | 0 |
| WORT | WORT 89.9 FM | WORT Community | ✓ | wort | 200 | spinitron.com/WORT/ | valid | — | 71 |
| WSUM | WSUM 91.7 FM | UW-Madison | ✓ | wsum | 200 | spinitron.com/WSUM/ | valid | — | 110 |
| WIUX | WIUX 99.1 FM | Indiana U | ✓ | wiux | 404 | spinitron.com/WIUX/ | **missing** | — | 0 |
| WREX | WREX | U Illinois | ✓ | wrex | 404 | spinitron.com/WREX/ | **missing** | — | 0 |
| WMTU | WMTU 91.9 FM | Michigan Tech | ✓ | wmtu | 404 | spinitron.com/WMTU/ | **missing** | — | 0 |
| KXUA | KXUA 88.3 FM | U Arkansas | ✓ | kxua | 200 | spinitron.com/KXUA/ | valid | — | 1 |
| KDUR | KDUR 91.9 FM | Fort Lewis | ✓ | kdur | 200 | spinitron.com/KDUR/ | valid | — | 53 |
| KUNM | KUNM 89.9 FM | UNM | ✓ | kunm | 404 | spinitron.com/KUNM/ | **missing** | — | 0 |
| KFAI | KFAI 90.3 FM | KFAI Community | ✓ | kfai | 200 | spinitron.com/KFAI/ | valid | — | 60 |
| KAOS | KAOS 89.3 FM | Evergreen State | ✓ | kaos | 200 | spinitron.com/KAOS/ | valid | — | 59 |
| KCSB | KCSB 91.9 FM | UC Santa Barbara | ✓ | kcsb | 200 | spinitron.com/KCSB/ | valid | — | 103 |
| KUCR | KUCR 88.3 FM | UC Riverside | ✓ | kucr | 200 | spinitron.com/KUCR/ | valid | — | 7 |
| KZSC | KZSC 88.1 FM | UC Santa Cruz | ✓ | kzsc | 200 | spinitron.com/KZSC/ | valid | — | 58 |
| KUCI | KUCI 88.9 FM | UC Irvine | ✓ | kuci | 404 | spinitron.com/KUCI/ | **missing** | — | 0 |
| KXLU | KXLU 88.9 FM | Loyola Marymount | ✓ | kxlu | 200 | spinitron.com/KXLU/ | valid | — | 86 |
| KSDT | KSDT 95.7 FM | UC San Diego | ✓ | ksdt | 404 | spinitron.com/KSDT/ | **missing** | — | 0 |
| KZSU | KZSU 90.1 FM | Stanford | ✓ | kzsu | 404 | spinitron.com/KZSU/ | **missing** | — | 0 |
| KSJS | KSJS 90.5 FM | San Jose State | ✓ | ksjs | 200 | spinitron.com/KSJS/ | valid | — | 58 |
| KCRH | KCRH 89.9 FM | Chabot College | ✓ | kcrh | 404 | spinitron.com/KCRH/ | **missing** | — | 0 |
| KTUH | KTUH 90.3 FM | U Hawaii | ✓ | ktuh | 200 | spinitron.com/KTUH/ | valid | — | 74 |
| KASC | KASC 1260 AM | Arizona State | ✓ | kasc | 404 | spinitron.com/KASC/ | **missing** | — | 0 |
| KUAZ | KUAZ 89.1 FM | U Arizona | ✓ | kuaz | 404 | spinitron.com/KUAZ/ | **missing** | — | 0 |
| KMNR | KMNR 89.7 FM | Missouri S&T | ✓ | kmnr | 404 | spinitron.com/KMNR/ | **missing** | — | 0 |
| KUPS | KUPS 90.1 FM | Puget Sound | ✓ | kups | 200 | spinitron.com/KUPS/ | valid | — | 0 |
| KGRG | KGRG 89.9 FM | Green River CC | ✓ | kgrg | 404 | spinitron.com/KGRG/ | **missing** | — | 0 |
| KLCC | KLCC 89.7 FM | Lane CC | ✓ | klcc | 404 | spinitron.com/KLCC/ | **missing** | — | 0 |
| CKUT | CKUT 90.3 FM | McGill | ✓ | ckut | 404 | spinitron.com/CKUT/ | **missing** | — | 0 |
| CJSR | CJSR 88.5 FM | U Alberta | ✓ | cjsr | 404 | spinitron.com/CJSR/ | **missing** | — | 363* |
| CFUV | CFUV 101.9 FM | U Victoria | ✓ | cfuv | 404 | spinitron.com/CFUV/ | **missing** | — | 0 |
| CKCU | CKCU 93.1 FM | Carleton | ✓ | ckcu | 404 | spinitron.com/CKCU/ | **missing** | — | 0 |
| CISM | CISM 89.3 FM | U Montréal | ✓ | cism | 404 | spinitron.com/CISM/ | **missing** | — | 0 |
| CHMR | CHMR 93.5 FM | Memorial | ✓ | chmr | 404 | spinitron.com/CHMR/ | **missing** | — | 0 |

**Summary:**
- Confirmed Spinitron members (200): **35 of 84** callsigns
- Not on Spinitron (404): **49 of 84** callsigns
- No blocked or transient failures observed.

*\*CJSR (363 7d spins) is NOT on Spinitron — its spins come from a `radio_browser_icy` watcher, not the spinitron_web adapter. The DB has two rows for CJSR-region: id 65347 (curated spinitron_web) with 0 spins, and id 11413 or similar (radio_browser ICY) with live data.*

---

## 5. Recognition Evidence Assessment

The `spinitron_web` adapter scrapes the public playlist page at `spinitron.com/{CALLSIGN}`. It exposes `rawArtist` and `rawTitle` per spin. Spinitron internally populates some station playlists via automated audio recognition (ACR/fingerprinting) in addition to DJ-logged entries.

**Finding: the database does not expose a reliable marker for Spinitron ACR vs. DJ-logged.** The `spins` table has `source` (adapter name, e.g. "spinitron_web") and `confidence` (resolution confidence, e.g. "text"), neither of which distinguishes ACR-filled from manually-logged playlist entries. The `shows` table carries DJ names for stations that log per-playlist, but `spinitron_web` only surfaces the _current_ top-of-page entry without show/DJ context.

Observable proxies (not proof of ACR):
- A confirmed Spinitron member (200 probe) with **zero 7-day spins despite being actively polled** could indicate: ACR failure at the station, summer silence, or the adapter failing to parse the page format — not distinguishable from DB evidence alone.
- **WUOG**: 381 spins / 15 distinct MBIDs — extremely low MBID diversity for a 7-day window suggests possible looped ACR data or repeated test entries, but this cannot be confirmed without viewing the actual playlist page.
- Stations with high resolve rates (KEXP 97%, Worldwide FM 86%, WUML 87%) reflect metadata quality (KEXP provides native MBIDs; others have clean text metadata), not ACR status.

---

## 6. Summary and R1 Inputs

### Stations confirmed working with useful data

| Station | Evidence | 7d raw | Notes |
|---|---|---|---|
| KEXP | kexp_api, native MBIDs, full DJ attribution | 906 | Best data quality; single source of named picker attribution |
| WRBB | Spinitron valid, spinitron_web active | 407 | Good volume, solid resolve rate |
| WUOG | Spinitron valid, spinitron_web active | 381 | Low MBID diversity — monitor |
| CJSR | radio_browser_icy watcher, not Spinitron | 363 | ICY source; Spinitron page 404 |
| WLUR | Spinitron valid, spinitron_web active | 349 | Strong quality |
| KVSC | Spinitron valid | 165 | Consistent |
| WBRS | Spinitron valid | 162 | Low resolve rate (18%) — metadata quality issue |
| WUML | Spinitron valid | 136 | High resolve rate |
| WZBC | Spinitron valid | 110 | Good |
| WSUM | Spinitron valid | 110 | Good |
| KDVS | Spinitron valid | 49 | Consistent |

### Genuinely silent stations (not working through any source)

**49 stations with 0 spins in both 7-day and 30-day windows** — these are not producing Lore data through any path. Key sub-groups:
- **Not on Spinitron + 0 spins**: Confirmed the embedded-list callsign doesn't resolve on Spinitron and produces no data: WNUR, WREK, WFMU, WXYC, KVRX, WMBR, WUSB, WVUM, WERS, WMWM, WGAM, WRPI, WICB, WITR, WRCU, WRHU, WVOF, WGSU, WBMB, WSBU, WSAM, WPTS, WUVT, WUFT, WVFS, WRGP, WHPK, WMHW, WDET, WUSC, WIUX, WREX, WMTU, KUNM, KUCI, KSDT, KZSU, KCRH, KASC, KUAZ, KMNR, KGRG, KLCC, CFUV, CISM, CKCU, CKUT, CHMR
- **On Spinitron but 0 spins 7d**: WBAR, KXUA, KUPS, WTBU (minimal), WCFM (minimal) — confirmed Spinitron members; adapter is reachable but producing near-zero data (may be summer hiatus, low programming hours, or page format issues)
- **Canadian stations with no adapter configured**: CHMR, CISM, CKCU — have `now_playing_source = null`; not polled at all

### Stations working through a different source than assumed

- **CJSR** (363 7d spins): DB row id 65347 uses `spinitron_web` but Spinitron returns 404. Active spins come from the `radio_browser_icy` watcher on a different station row (id varies). Effectively working, but not via Spinitron.

### Radio-browser longtail health

- 405 active longtail stations with `radio_browser_icy` as source
- Many produce moderate spin volumes; the audit's full longtail table is not expanded here (focus is curated stations per scope)
- Top producers among longtail: high volume stations exist (4687 with 2073 7d spins, 4741 with 2730 7d spins) but many are commercial/lounge formats with low resolve rates

### Assumptions and limitations

1. "7-day" and "30-day" windows are computed relative to `now()` at query time (2026-08-08T14:58:50 UTC). Weekend-heavy programming means some stations may have more data in the prior 7-day window than the past 7 days.
2. The `spinitron_web` adapter is a change-detection (now-playing) source — it only captures the track that was playing when polled (every 150 s). A station that programs exclusively between polls could under-represent its volume.
3. Distinct MBID count is a lower bound on actual unique tracks (some tracks are unresolved and thus not counted).
4. The Spinitron probe (`spinitron.com/{CALLSIGN}`) tests the public station page, not the adapter's internal endpoint. A single 404 is treated as "missing" per protocol; a single failure is not treated as proof of non-membership, but here every 404 correlated with 0 database spins, which is supporting evidence.
5. No SPINITRON_API_KEY is set — the full ~300+ station Spinitron directory has never been imported. Only the 84-station embedded fallback list has been seeded.
