# Instrumental Radio audit

Inventory audited **2026-09-03 16:34:27 UTC**.

## Current evidence-backed count

This report is the output of the bounded audit against the current development
inventory. The durable copy at `GET /api/admin/instrumental-audit` contains the
per-track records and is the reproducible source of truth.

### Confirmed instrumental — 0

No station is counted as confirmed before Lore has sampled recent unique
resolved tracks and LRCLIB has explicitly marked at least three of them
instrumental. A missing lyric result is not corroboration.

### Mostly instrumental — 0

No station had complete checked coverage with at least three explicit
instrumental outcomes covering 75% of its sample and no vocal contradiction.

### Unknown / insufficient evidence — 25

Outcome columns below are `instrumental / lyrics / miss / transient / unchecked`.

| Station | Sample outcomes | Evidence and recent genres | Visibility | Vocal contradictions |
|---|---:|---|---|---|
| AmbientRadio (MRG.fm) | 24 (3 / 1 / 18 / 2 / 0) | Directory hint; ambient, electronic, downtempo, experimental, dark ambient, experimental rock | visible | **David Sylvian — The Healing Place** |
| Fluid Radio | 24 (3 / 1 / 19 / 1 / 0) | Directory hint; electronic, ambient, classical, drone, contemporary classical, experimental, IDM, modern classical | visible | **Message to Bears — Blossom** |
| MyNoise Drone Zone | 2 (0 / 0 / 2 / 0 / 0) | Name hint; no recent genre profile | visible | none |
| Nightride FM — Chillsynth | 4 (2 / 0 / 2 / 0 / 0) | [Official instrumental claim](https://nightride.fm/); live ICY-resolved sample remains below the three-track threshold | visible, Specialist | none sampled; **not proof of absence** |
| Planet Ambi HD | 24 (2 / 0 / 20 / 2 / 0) | Directory hint; ambient, classical, dark ambient, electronic, modern classical, post-rock | visible | none |
| RADCAP: DRONE AMBIENT | 24 (0 / 1 / 20 / 3 / 0) | Name hint; electronic, ambient, drone, dark ambient, industrial, classical, contemporary classical, experimental | visible | **Oneohtrix Point Never — Zebra** |
| Radio Caprice - Drone Ambient | 24 (0 / 0 / 23 / 1 / 0) | Name hint; ambient, electronic, experimental, industrial, dark ambient, drone | hidden | none |
| Radio Caprice Industrial/Dark/Ritual Ambient | 24 (1 / 0 / 18 / 5 / 0) | Directory hint; dark ambient, electronic, ambient, experimental, industrial, drone, electro-industrial | hidden | none |
| SomaFM Drone Zone (128k MP3) | 24 (2 / 0 / 21 / 1 / 0) | Directory hint; dark ambient, space ambient | hidden duplicate | none |
| SomaFM — Drone Zone | 24 (0 / 0 / 24 / 0 / 0) | Name hint; ambient, electronic, experimental | hidden | none |
| 0R Coffee Lounge | 0 (0 / 0 / 0 / 0 / 0) | Directory instrumental hint; generic background/lounge | hidden, rejected | none sampled |
| 0R Hotel Lounge | 0 (0 / 0 / 0 / 0 / 0) | Directory instrumental hint; generic background/lounge | hidden, rejected | none sampled |
| 0R Mozart Classical | 0 (0 / 0 / 0 / 0 / 0) | Directory instrumental hint; generic background | hidden, rejected | none sampled |
| 0R Music for Sleep | 0 (0 / 0 / 0 / 0 / 0) | Directory instrumental hint; sleep/utility | hidden, rejected | none sampled |
| 0R Piano Jazz Lounge | 0 (0 / 0 / 0 / 0 / 0) | Directory instrumental hint; generic background/lounge | hidden, rejected | none sampled |
| 0R Romantic Piano | 0 (0 / 0 / 0 / 0 / 0) | Directory instrumental hint; generic background | hidden, rejected | none sampled |
| 1000 Melodien | 0 (0 / 0 / 0 / 0 / 0) | Directory instrumental hint only | visible, not admitted | none sampled |
| 1001 Trumpet Song | 0 (0 / 0 / 0 / 0 / 0) | Directory instrumental hint only | visible, not admitted | none sampled |
| Antenne Niedersachsen Relax | 0 (0 / 0 / 0 / 0 / 0) | Directory instrumental hint; generic relax format | hidden, rejected | none sampled |
| EPIC CLASSICAL - Classical Pan Flute | 0 (0 / 0 / 0 / 0 / 0) | Directory instrumental hint only | visible, not admitted | none sampled |
| EPIC CLASSICAL - Classical Violin | 0 (0 / 0 / 0 / 0 / 0) | Directory instrumental hint only | visible, not admitted | none sampled |
| Experimentalgems | 0 (0 / 0 / 0 / 0 / 0) | Directory instrumental hint only | visible, not admitted | none sampled |
| Radio Lagoshevtsi | 0 (0 / 0 / 0 / 0 / 0) | Directory instrumental hint only | visible, not admitted | none sampled |
| Slow Focus \| NTS | 0 (0 / 0 / 0 / 0 / 0) | Directory instrumental hint only; mixed network/show identity | visible, not admitted | none sampled |
| Total instrumental | 0 (0 / 0 / 0 / 0 / 0) | Directory instrumental hint only; generic identity | visible, not admitted | none sampled |

Thus the current count is **0 confirmed**, **0 mostly**, and **25 unknown**.
Radio Browser labels alone promoted none of them. The single sampled vocal
contradiction keeps AmbientRadio out despite three explicit instrumental tracks.

## Reproducible method

- Candidate set: every station whose name or stored directory tags contain
  `instrumental` or `drone`, capped at 100 stations per run.
- Sample: at most 24 unique resolved recordings per station, most-recent first,
  from the previous 180 days.
- Provider work: at most 150 sequential LRCLIB lookups per run with a 250ms gap.
  Definitive outcomes are cached; transient failures retain their own status
  and a 15-minute retry cooldown.
- Track outcomes: `lyrics_found`, `instrumental`, `no_result`,
  `transient_failure`, and `not_checked` remain distinct.
- **Confirmed rule:** an official station-format claim with a citable source,
  at least three explicit instrumental track responses, complete sampled
  coverage, and no sampled lyric hit.
- **Mostly rule:** complete checked coverage, at least three explicit
  instrumental track responses covering at least 75% of the sample, and no
  sampled lyric hit, but no sufficient official format claim.
- Everything else is **unknown / insufficient evidence**. In particular,
  `no_result` never counts as instrumental and `drone` is only a candidate hint.

Each run upserts `instrumental_station_audits` by stable station id. Re-running
the seed preserves station ids and spin history; re-running the audit produces
the same classification for the same evidence without repeating definitive
lyrics requests.

## Existing tag review

- Non-music utilities (rain, white noise, sleep sounds) remain blocked by the
  Radio Browser name guard and cannot enter the audit roster as music stations.
- Lounge, coffee-shop, generic background, duplicate, broken, and low-vote
  directory rows retain the existing rejection/soft-hide gates.
- Musical ambient/drone remains eligible for review, but is never accepted
  automatically because of genre alone.

## Ranked candidate slate

1. **Nightride FM — Chillsynth — admitted.** Official instrumental claim,
   sanctioned 320kbps stream, live artist-title metadata, distinctive focused
   programming. Automated curation is labeled honestly.
2. **SomaFM n5MD — Specialist candidate, instrumental status unproven.**
   Official station and sanctioned streams are strong; its official description
   promises ambient, modern composition, post-rock, and experimental electronic
   music, not a lyric-free format. Hold the instrumental claim pending samples.
3. **Systrum Sistum — promising electronic/electroacoustic candidate.**
   Long-running independent “Radio Electronica” identity, public schedule and
   recent-play surfaces, but no official lyric-free promise was found.
4. **Post-Rock Nation / Laut.fm Post-Rock — mostly-instrumental candidates.**
   Focused post-rock programming is relevant, but post-rock genre identity is
   not itself a no-vocals claim; verify ownership, stream metadata, duplicates,
   and a representative sample before seeding.
5. **6forty Radio — post-rock/post-metal candidate.** Directory descriptions
   are strong, but the current official ownership/playback surface was not
   sufficiently verifiable, so no row is added.
6. **Reverb Riff Radio — rejected for now.** The official artist-permission and
   non-commercial policy is positive, but the station was offline during
   review and “surf rock” is not necessarily instrumental.
7. **Nightride Datawave — adventurous electronic candidate.** Officially
   described as glitchy synthwave/IDM/retro-computing, but unlike Chillsynth it
   has no explicit instrumental claim. Review separately rather than inheriting
   the sibling channel’s evidence.

No quota is applied; only Nightride Chillsynth cleared the identity, stream,
metadata, and official-format gates in this pass.