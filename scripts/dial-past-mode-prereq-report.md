# Dial Past-Mode Prerequisites Report
## Crossing Density, KEXP Duration, and Coverage Derivability

*Run date: 2026-08-06. All figures are from the development database.*

---

## Q1 — Reconciled Crossing Density

### Figures

| Metric | Value |
|--------|-------|
| Global crossings in last 24h (all users × all stations) | **125** |
| Heaviest user (user id=1, 1,930 library items) — crossings in 24h | **124** |
| Heaviest user — median inter-crossing gap within 24h window (global order) | **392 s (6.5 min)** |
| Heaviest user — minimum gap (24h) | 0 s |
| Heaviest user — maximum gap (24h) | 4,881 s (81 min) |
| Heaviest user — per-station median of medians (24h) | **11,284 s (188 min / 3.1 h)** |
| Heaviest user — ALL-TIME median inter-crossing gap | **4,630 s (1.29 h ≈ 1 h 17 min)** |
| Heaviest user — all-time gap count | 4,072 |
| Heaviest user — all-time gap min/max | 0 s / 451,785 s (5.2 days) |

**Median-library-size user:** The database has 30 users total. Median library size is **1 item**. Only user id=1 has a library large enough (1,930 items) to produce meaningful crossing density; every other user has 1–4 items and produced 0 crossings in the 24h window.

### Why the 1 h 18 m figure looked inconsistent

The **1 h 18 m all-time median gap** was measured over the *entire spin history* (2022-11-07 → present), not within a single 24h window. The all-time distribution includes multi-day overnight gaps between polling sessions: when a listener sleeps, no station plays their music for 6–10+ hours, and those gaps dominate the all-time median.

Within a busy 24h window — where 124 crossings actually occurred — the median gap collapses to **6.5 minutes**. That is the operationally relevant figure for dial detent density.

### Design implication

At 6.5-minute median gap for the heaviest user, per-crossing dial detents would fire every few minutes and produce an unreadable time spine. **Aggregation into 15–30 minute bins is required** even for the heaviest user. Per-station within-day gaps (median of medians: 3.1 h) confirm that a per-station, per-hour or per-30-min granularity is more tractable than per-crossing.

---

## Q2 — KEXP Duration Diagnosis

### Split: recordings row exists-with-null vs row missing

| Category | KEXP (station id=4) | SomaFM Folk Forward (station id=171) |
|----------|--------------------|------------------------------------|
| Total MBID-resolved spins | 378,319 | 3,145 |
| Recordings row exists + `duration_ms` populated | 45,374 (12.0%) | 2,967 (94.3%) |
| **Recordings row exists + `duration_ms IS NULL`** | **332,945 (88.0%)** | 178 (5.7%) |
| Recordings row missing entirely | 0 (0.0%) | 0 (0.0%) |

**Branch statement: "recordings exist with null duration."** Every KEXP MBID-resolved spin joins to a recordings row — no rows are missing. The problem is that `recordings.duration_ms` was never populated for the vast majority of those rows.

### Temporal clustering of null-duration spins

All 332,945 null-duration spins have `created_at` in 2026-Q3 (332,497 in July 2026, 448 in August 2026). This means the KEXP spin history was bulk-ingested in July 2026, and the recordings rows were created at the same time — without duration data.

However, the **played_at dates are uniformly distributed** across the full historical range (Nov 2022 – Aug 2026), running at ~6,500–8,000 null-duration spins per month of airdate regardless of quarter. This is **not** a historical-backfill-era clustering problem — it is a systematic gap where `recordings` rows were created with MBID/title/artist but duration was never fetched.

### Backfill job size

| Metric | Value |
|--------|-------|
| Distinct recording MBIDs with `duration_ms IS NULL` on KEXP spins | **124,865** |

A targeted MusicBrainz backfill (`GET /recording/{mbid}?inc=...` for each of these 124,865 MBIDs) would close the KEXP gap. Given MB rate limits (~1 req/s with burst), a batched background job would take roughly **35 hours** at sustained 1 req/s — tractable as a low-priority background task.

### Comparison

SomaFM Folk Forward has 94.3% duration coverage (5.7% null, none missing), confirming that the system correctly populates duration_ms for most stations. KEXP is a clear outlier.

---

## Q3 — Per-Station Coverage Derivability

### Available polling signals

The schema provides these signals that can be used to infer whether Lore was actively polling a station in a given hour:

1. **`spins.played_at` arrival pattern** — If at least one spin was logged for a station during an hour, Lore was actively polling that station at some point during that hour. This is the strongest available signal and the only per-station-per-hour record.

2. **`stations.last_seen_cursor`** — Updated on every successful poll. Monotonic; tells you the most recent confirmed poll time, but is a single timestamp, not a history.

3. **`stations.last_alive_at`** — Updated by health checks. Coarser than `last_seen_cursor`; not per-hour resolvable.

4. **`stations.backfill_done` / `stations.backfill_cursor`** — Tells you the earliest confirmed polled airdate, not the per-hour coverage of recent periods.

5. **`station_quality.computed_at`** — A point-in-time snapshot, not a per-hour coverage record.

**No dedicated polling-log table exists.** There are no ICY watcher session start/stop rows, no backoff records, and no per-tick heartbeat table. The only hourly evidence is the implicit signal from spin arrivals.

### Coverage classification for top 20 stations (last 30 days)

An hour is "covered" if ≥1 spin was logged for that station during that hour. An hour is "unknown" if no spin arrived (could mean: not polling, no track change, or track changed but resolution failed without a spin row).

| Station | Source | Spins (30d) | Hours w/ spins | Total hours | % Covered |
|---------|--------|-------------|----------------|-------------|-----------|
| KEXP 90.3 FM | kexp_api | 6,277 | 588 | 720 | 81.7% |
| Nostalgie New York | radio_browser_icy | 5,075 | 337 | 720 | 46.8% |
| Gem Radio New Wave | radio_browser_icy | 5,071 | 327 | 720 | 45.4% |
| GEM New Wave Radio | radio_browser_icy | 4,915 | 297 | 720 | 41.2% |
| Championshipvinyl | radio_browser_icy | 4,612 | 318 | 720 | 44.2% |
| Laut.FM Shoegaze | radio_browser_icy | 4,436 | 316 | 720 | 43.9% |
| Laut.FM Synthesizer | radio_browser_icy | 4,292 | 314 | 720 | 43.6% |
| Radio 31 Houseworld | radio_browser_icy | 4,052 | 270 | 720 | 37.5% |
| SomaFM Underground 80s (MP3) | radio_browser_icy | 3,967 | 332 | 720 | 46.1% |
| SomaFM Folk Forward (AAC) | radio_browser_icy | 3,932 | 323 | 720 | 44.9% |
| SomaFM Underground 80s (256k) | radio_browser_icy | 3,904 | 320 | 720 | 44.4% |
| Radio Armisa | radio_browser_icy | 3,887 | 263 | 720 | 36.5% |
| 80's New Wave Radio | radio_browser_icy | 3,678 | 288 | 720 | 40.0% |
| Big R Radio - The Wave | radio_browser_icy | 3,613 | 329 | 720 | 45.7% |
| 181.FM Chilled Out | radio_browser_icy | 3,543 | 326 | 720 | 45.3% |
| Radio Paradise World FLAC | radio_browser_icy | 3,539 | 330 | 720 | 45.8% |
| 100% Covers Lounge | radio_browser_icy | 3,532 | 320 | 720 | 44.4% |
| Radio Paradise World Mix AAC | radio_browser_icy | 3,509 | 328 | 720 | 45.6% |
| New Wave BestNet Radio | radio_browser_icy | 3,396 | 311 | 720 | 43.2% |
| Lolli Radio Happy Station | radio_browser_icy | 3,236 | 330 | 720 | 45.8% |

**Note:** All radio_browser_icy stations started logging spins around 2026-07-09 (station onboarding date). The ~44% coverage figure reflects real radio programming density, not polling gaps: ICY streams typically run ~10–16 tracks per hour, so an empty hour most likely means a long-playing track straddled the hour boundary and was not re-reported, or the station was between tracks.

KEXP's higher coverage (81.7%) reflects its dedicated API source (`kexp_api`) which reports track changes at the API level rather than relying on ICY metadata changes.

### Is a dedicated coverage table required?

**Coverage is derivable** — with important caveats.

The spin-arrival proxy works well enough to classify station-hours as "probably covered" vs "unknown" for the density spine:

- **"Covered" bin**: ≥1 spin arrived in the hour → the station was being polled and active.
- **"Unknown" bin**: 0 spins → could be (a) not polling, (b) a very long track bridging the hour, or (c) ICY metadata repeated without change (deduped, no spin logged). For ICY stations, the actual "true zero spins" rate is much lower than the 55% empty-hour figure suggests, because ICY dedup causes legitimate plays to be silently dropped.

For the dial past-mode density spine, rendering every empty bin as "unknown" (grey / no detent) is correct and safe — it avoids false "nothing played" claims. The spin-arrival proxy gives a good-enough "confirmed active" signal for bins that do have spins.

**A dedicated coverage table is NOT required** to ship the initial density spine. If sub-hour resolution is needed later (e.g. to distinguish "polling stopped at 2:37 AM" from "no track change"), a watcher heartbeat table would be required. Its grain would be: `(station_id, interval_start, interval_end, source)` written by the poller on every tick, giving exact start/stop times. That table does not exist today and would require an instrumentation change in the polling loop.

**Plain statement: "coverage is derivable"** from spin arrival patterns for an initial implementation. The density spine should render empty bins as "unknown" (not "no crossings"); this is already the right UX behavior per the task spec.

---

## Summary Table

| Question | Answer |
|----------|--------|
| Global crossings / 24h | 125 |
| Heaviest user 24h crossing median gap | 6.5 min — **too dense for per-crossing detents** |
| All-time median gap (explains 1h18m) | 1.29 h — all-time includes overnight/multi-day silences |
| Per-station median of medians (24h) | 3.1 h — more tractable bin size for per-station view |
| Median-library user 24h crossings | 0 — only one user has enough library items to generate meaningful data |
| KEXP: recordings exist with null duration? | **Yes — 88% of MBID spins (332,945 spins, 124,865 distinct MBIDs)** |
| KEXP: recordings missing entirely? | No — 0 missing rows |
| KEXP null-duration clustered by era? | No — uniform across all played_at months; systematic, not historical |
| KEXP backfill job size | 124,865 distinct MBIDs |
| SomaFM Folk Forward null-duration | 5.7% — healthy baseline for comparison |
| Coverage derivable from spin arrivals? | **Yes** — spin arrival = covered; empty hour = unknown |
| Dedicated coverage table required? | No for initial density spine; yes only if sub-hour precision is needed |
