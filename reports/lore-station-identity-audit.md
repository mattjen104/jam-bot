# Lore Station Identity Audit

## Soundtap candidate audit — September 4, 2026

The Soundtap comparison now uses an evidence ledger rather than callsign-only
overlap. Each match records support or conflict from callsign, normalized
brand/organization, official domain, geography, stream identity, and configured
identity. A callsign or geography by itself cannot trigger an automatic action.

The generated operator artifact is
`research/soundtap-schedule-gap.json`. It separates:

- shared identities, including branded matches;
- ambiguous or conflicting identities quarantined from action;
- truly absent listings ranked by first-party candidate readiness; and
- a weak incumbent cohort evaluated over the same seven-day Lore observation
  window used for monitored candidates.

The preserved Soundtap snapshot contains no first-party stream, homepage, or
schedule URLs for absent stations, so those records honestly remain
`needs_first_party_evidence`; Soundtap presence and tags add zero readiness
points. An operator may stage a candidate only after Lore records its own
first-party homepage, stream, polling adapter, and a high-confidence identity.
The refresh command can then start one explicitly named seven-day trial. Trial
stations remain hidden and crossing-ineligible while Lore gathers stream
health, fresh spins, unique recording and artist breadth, resolution quality,
and schedule freshness.

Retain, trial, and reject recommendations are based only on Lore observations.
The workflow never promotes or removes a station automatically, never treats
Soundtap popularity or homepage copy as quality evidence, and never copies
Soundtap schedule data.

**Audit date:** September 2, 2026  
**Data source:** Current Lore development database  
**Scope:** The 43 stations in the default Anchor, Campus, and Public & Community pool  
**App changes:** None

## Recommendation

Lore can responsibly produce **20 useful station identity sentences now**:

- **16 ready:** enough recent resolved music, artist/track breadth, genre evidence, and freshness for a concise listener-facing sentence.
- **4 provisional:** enough recent music for a cautious sentence, but genre coverage or first-party context is thinner and should receive editorial review.
- **23 insufficient:** no sentence should be published yet because actual-playing evidence is absent, poorly resolved, stale, or too sparsely enriched.

This revises the initial database-only estimate of 21 high-confidence plus 3 music-only stations. That first gate counted resolved spins, a homepage blurb, and any genre profile. A station-by-station audit showed that those conditions can still admit navigation text masquerading as a blurb, show titles masquerading as artists, or only a handful of genre-tagged recordings. Accuracy requires a stricter editorial gate.

Across the full 509-station normal directory, 135 stations pass the earlier mechanical gate. That is an upper bound, not a publishable count. Applying the stricter quality review seen here will likely yield roughly **45–55% fewer ready sentences**, or approximately **60–75 useful stations**, until metadata enrichment improves.

## Evidence policy

### Primary evidence: what the station actually played

- Use a rolling **90-day** spin window to characterize the station.
- Use the latest **30 days** to confirm that the evidence is still fresh.
- Require at least **50 resolved spins**, **40 unique recordings**, and **30 unique artists** before describing musical character.
- Require enough genre-tagged resolved spins to support each named genre. A genre appearing once or twice is not station identity.
- Use the median age of dated recordings only as a coarse “current-leaning” or “catalog-leaning” signal. Do not publish the numeric score as if it were precise.
- Ignore top-artist values that look like station IDs, show titles, host names, placeholders, or metadata parser artifacts.

### Secondary evidence: first-party context

- A station homepage blurb can establish mission, organizational identity, or a location explicitly named by the station.
- A recently scraped official schedule can support the existence of named shows or hosts.
- First-party claims do **not** establish what the station is currently playing; observed spins remain authoritative.
- Lore categories and Radio Browser tags may help organize the audit but are not proof of musical character.

### Location

All 43 stations have at least country-level location data, but none currently have both structured city and country fields. A few first-party blurbs explicitly identify a city. Sentences should use country by default and use a city only when the station’s own page states it.

### Grounding rules

A sentence must be rejected if it introduces an unsupported:

- Proper noun
- Genre or subgenre
- City or region
- “Live,” “local,” “commercial-free,” “DJ-led,” or “community” claim
- New-music or catalog claim
- Listener promise unrelated to the measured rotation

The safest sentence pattern is:

> From **[grounded place]**, **[station]** has recently moved among **[supported genres]** across **[measured breadth]**, making it a useful tune-in for **[plain-language restatement of those same facts]**.

Clauses should be omitted when their evidence is missing rather than replaced with generic praise.

## Ready sentences

These 16 stations meet the stricter evidence gate. Counts below describe the audited 90-day window.

### BBC 6 Music

**Draft:** From the UK, BBC 6 Music’s recent logs range across rock, electronic, and indie rock from 2,079 artists, with a six-year median track age—a strong tune-in for contemporary guitar music with electronic edges.

**Evidence:** 3,890 spins; 2,427 resolved (62.4%); 1,825 unique resolved tracks; 315 genre-tagged plays; official homepage scraped August 28; newest spin September 2.

### CJSR 88.5 FM

**Draft:** From Canada, CJSR’s recent logs span rock, electronic, and experimental music from 1,010 artists, with a median track age of zero years—a useful tune-in for new-release variety with an exploratory edge.

**Evidence:** 2,143 spins; 721 resolved (33.6%); 568 unique resolved tracks; 78 genre-tagged plays; 11 scheduled shows; official homepage identifies the station as Edmonton-based and volunteer-powered; newest spin September 2.

### KALX 90.7 FM

**Draft:** From the US, KALX’s recent rotation moves among rock, electronic, and pop from 1,256 artists, with a three-year median track age—a useful tune-in for wide, current-leaning variety.

**Evidence:** 1,736 spins; 1,070 resolved (61.6%); 942 unique resolved tracks; 182 genre-tagged plays; official homepage scraped August 28; newest spin September 2.

### KCSM 91.1 FM

**Draft:** From the US, KCSM’s recent rotation centers on jazz, hard bop, and bebop across 570 artists, with a 23-year median track age—a focused tune-in for deep jazz catalog.

**Evidence:** 826 spins; 409 resolved (49.5%); 390 unique resolved tracks; 59 genre-tagged plays, 52 of them tagged jazz; official homepage identifies the College of San Mateo and San Francisco Bay Area; newest spin September 2.

### KDVS 90.3 FM

**Draft:** From the US, KDVS’s recent logs range across rock, electronic, and indie rock from 1,210 artists, with a 17-year median track age—a useful tune-in for broad freeform music with plenty of catalog depth.

**Evidence:** 1,525 spins; 869 resolved (57.0%); 810 unique resolved tracks; 181 genre-tagged plays; official homepage identifies Davis, California and describes the station as freeform; newest spin September 2.

### KEXP 90.3 FM

**Draft:** From the US, KEXP’s recent logs span rock, alternative rock, and electronic music from more than 10,000 artists, with a seven-year median track age—a strong tune-in for broad, recent-leaning discovery.

**Evidence:** 24,146 spins; 21,492 resolved (89.0%); 15,260 unique resolved tracks; 6,721 genre-tagged plays; 8 scheduled shows; official homepage scraped August 28; newest spin September 2.

### KVSC 88.1 FM

**Draft:** From the US, KVSC’s recent rotation centers on rock, indie rock, and alternative rock across 856 artists, with a median track age of zero years—a useful tune-in for current guitar music.

**Evidence:** 1,814 spins; 1,300 resolved (71.7%); 892 unique resolved tracks; 179 genre-tagged plays; official homepage scraped August 28; newest spin September 2.

### KXLU 88.9 FM

**Draft:** From the US, KXLU’s recent logs move among rock, electronic, and alternative rock from 791 artists, with a 16-year median track age—a useful tune-in for varied guitar and electronic catalog.

**Evidence:** 929 spins; 534 resolved (57.5%); 506 unique resolved tracks; 85 genre-tagged plays; 40 scheduled shows; newest spin August 19 and official schedule scraped August 26.

### WBRS 100.1 FM

**Draft:** From the US, WBRS’s recent genre evidence leans toward blues, rock, and blues rock, with a 29-year median track age—a useful tune-in for older blues-and-rock catalog.

**Evidence:** 2,553 spins; 1,747 resolved (68.4%); 512 unique resolved tracks; 219 genre-tagged plays; official homepage identifies Brandeis University in Waltham; newest spin September 2. Artist-level metadata contains repetition, so the draft deliberately avoids a breadth claim.

### WHRB 95.3 FM

**Draft:** From the US, WHRB’s recent logs range across jazz, rock, and electronic music from 863 artists, with a 23-year median track age—a useful tune-in for wide-ranging catalog exploration.

**Evidence:** 1,258 spins; 493 resolved (39.2%); 462 unique resolved tracks; 94 genre-tagged plays; official homepage identifies Cambridge; newest spin September 2.

### WKCR 89.9 FM

**Draft:** From the US, WKCR’s recent logs move among jazz, country, and rock from 523 artists, with a 24-year median track age—a useful tune-in for deep catalog that crosses traditional genre lines.

**Evidence:** 1,311 spins; 678 resolved (51.7%); 628 unique resolved tracks; 110 genre-tagged plays; 3 scheduled shows; official homepage identifies New York; newest spin September 2.

### WMFO 91.5 FM

**Draft:** From the US, WMFO’s recent rotation spans rock, electronic, and indie rock from 826 artists, with a six-year median track age—a useful tune-in for freeform variety with a recent lean.

**Evidence:** 2,496 spins; 1,450 resolved (58.1%); 721 unique resolved tracks; 391 genre-tagged plays; official homepage describes the station as Tufts Freeform Radio; newest spin September 2.

### WPRB 103.3 FM

**Draft:** From the US, WPRB’s recent logs range across rock, electronic, and indie rock from 1,707 artists, with a 12-year median track age—a useful tune-in for independent, wide-ranging rotation.

**Evidence:** 2,052 spins; 1,030 resolved (50.2%); 972 unique resolved tracks; 150 genre-tagged plays; official homepage identifies Princeton and describes the station as community-supported independent radio; newest spin September 2.

### WRCT 88.3 FM

**Draft:** From the US, WRCT’s recent resolved sample moves among rock, alternative rock, and pop from 1,493 logged artists, with a roughly 20-year median track age—a useful tune-in for broad catalog-oriented rotation.

**Evidence:** 1,775 spins; 388 resolved (21.9%); 359 unique resolved tracks; 56 genre-tagged plays; 40 scheduled shows; newest spin September 2. The low resolution rate means the sentence remains deliberately broad.

### WTMD 89.7

**Draft:** From the US, WTMD’s recent rotation centers on rock, alternative rock, and indie rock across 1,231 artists, with a three-year median track age—a useful tune-in for current-leaning guitar music.

**Evidence:** 8,763 spins; 5,649 resolved (64.5%); 1,926 unique resolved tracks; 662 genre-tagged plays; station name identifies Towson, Maryland; newest spin September 2. The scraped homepage blurb contains navigation text and was not used.

### WZBC 90.3 FM

**Draft:** From the US, WZBC’s recent logs range across rock, electronic, and indie rock from 1,434 artists, with a 12-year median track age—a useful tune-in for varied alternative and electronic rotation.

**Evidence:** 1,856 spins; 1,049 resolved (56.5%); 962 unique resolved tracks; 145 genre-tagged plays; official homepage identifies Boston College; newest spin September 2.

## Provisional music-only sentences

These four drafts are supportable but should receive editorial review because genre coverage is thin relative to the resolved sample, or first-party descriptive context is weak.

### CKUA Radio

**Draft:** From Canada, CKUA’s available recent genre sample moves among rock, pop, and country, while its dated tracks lean recent—a cautious tune-in for a broad contemporary mix.

**Evidence:** 1,464 spins; 709 resolved; 448 unique resolved tracks; only 41 genre-tagged plays; median track age 7 years; 29 scheduled shows; newest spin September 2.

**Caution:** The genre sample covers 5.8% of resolved spins, so the sentence explicitly says “available recent genre sample.”

### FIP

**Draft:** From France, FIP’s available recent genre sample ranges across rock, pop, and soul, with electronic and jazz close behind—a cautious tune-in for cross-genre catalog.

**Evidence:** 3,419 spins; 2,009 resolved; 1,816 unique resolved tracks; 295 genre-tagged plays; median track age 14 years; newest spin September 2.

**Caution:** The first-party blurb is truncated and genre coverage is 14.7% of resolved spins, so no station-mission claim is used.

### KCRW — Eclectic 24

**Draft:** From the US, KCRW Eclectic 24’s recent genre evidence spans rock, pop, and electronic music across 1,464 logged artists, with a one-year median track age—a useful tune-in for current cross-genre rotation.

**Evidence:** 4,923 spins; 3,024 resolved; 1,371 unique resolved tracks; 472 genre-tagged plays; median track age 1 year; newest spin September 2.

**Caution:** No usable homepage blurb is stored, so the sentence is based only on observed music and country.

### WUOG 90.5 FM

**Draft:** From the US, WUOG’s available recent genre sample centers on rock and indie rock with some electronic music, and its dated tracks lean new—a cautious tune-in for current guitar-led rotation.

**Evidence:** 3,036 spins; 1,888 resolved; 338 unique resolved tracks; 54 genre-tagged plays; median track age 2 years; newest spin September 2.

**Caution:** The resolved history contains heavy repetition and genre coverage is only 2.9%, so the sentence avoids a breadth claim.

## Stations without enough evidence

### No usable recent playing history

These stations currently have no logged 90-day spins and therefore cannot receive a sentence about what they actually play:

- CFUV 101.9 FM
- CHUO 89.1 FM
- CJSF 90.1 FM
- CKCU 93.1 FM
- KVRX 91.7 FM
- Rádio Universitária do Minho
- WHPK 88.5 FM
- WICB 91.7 FM
- WPFW 89.3 FM
- WUSB 90.1 FM
- WVUM 90.5 FM
- WXDU 88.7 FM
- WXYC 89.3 FM

Several have strong first-party descriptions or schedules. Those can describe the organization, but not its observed rotation, so they remain excluded.

### Feed present but resolution unusable

- **NTS 1:** 26 spins, 2 resolved; metadata is dominated by station/show labels.
- **NTS 2:** 19 spins, 1 resolved; metadata is dominated by station/show labels.
- **Rinse FM:** 6 spins, 0 resolved; one metadata value is a placeholder.
- **WREK 91.1 FM:** 553 spins, 9 resolved; insufficient resolved music and no genre evidence.
- **WMBR 88.1 FM:** 97 spins, 0 resolved; no music evidence despite a working feed.
- **CKUT 90.3 FM:** 7 spins, 0 resolved; values are backup/automation labels rather than tracks.

### Resolved sample still too sparsely described

- **Dublab:** 121 resolved spins but only 12 genre-tagged plays; top-artist values contain station IDs and placeholders.
- **WBGO 88.3 FM:** 133 resolved spins but only 22 genre-tagged plays and no homepage blurb. The jazz signal is plausible but below the conservative publication threshold.
- **WDIY 88.1 FM:** 70 resolved spins but only 2 genre-tagged plays; no supportable musical identity sentence yet.
- **WESU 88.1 FM:** 204 resolved spins but only 20 genre-tagged plays; the newest available spin is August 19.

## Most useful data for choosing what to hear

The station sentence should remain compact. More volatile or detailed evidence belongs in separate tune-in signals rather than being forced into prose.

Recommended listener signals, in priority order:

1. **Playing now:** Fresh artist and title, with freshness status.
2. **Recent sound:** Two or three genres supported by the rolling 90-day rotation.
3. **Rotation age:** Plain language such as “mostly new releases,” “mixed-era,” or “deep catalog,” backed by enough dated recordings.
4. **Breadth:** A coarse label derived from unique artists and tracks, adjusted for the number of observed spins.
5. **Current show:** Show or host only when the current time falls inside a non-voided, recently scraped official schedule block.
6. **Source location:** City when first-party or structured data supports it; otherwise country.
7. **Confidence:** Internally preserve sample size, resolution rate, genre coverage, last spin time, and source timestamps even if the UI eventually hides the numbers.

Avoid using listener popularity, Radio Browser votes, or click counts in the identity sentence. Those may rank stations, but they do not explain what someone will hear.

## Production path if approved

1. Build a read-only fact packet from the rolling 90-day and 30-day windows.
2. Compute readiness from explicit minimum sample, breadth, genre coverage, and freshness thresholds.
3. Generate a bounded sentence only for ready or editorially approved provisional stations.
4. Store each claim’s supporting fields and timestamps beside the draft.
5. Run an automated grounding check and an editorial review before publication.
6. Recompute periodically, but do not rewrite copy for small day-to-day fluctuations; require a meaningful evidence change.

No identity sentence should silently fall back to generic marketing copy. “Not enough evidence yet” is the accurate state.