# Dial Time-Axis Prerequisites Report

Generated: 2026-08-06. Gates Tasks #1520 (spine), #1521 (scan), #1524 (KEXP backfill).

---

## Q1 — Reconciled crossing density

### Heaviest user (1,930 library items)

| Metric | Value |
|--------|-------|
| Crossings in last 24h | 126 |
| Avg gap within 24h window | 683s (11.4 min) |
| **Median gap within 24h window** | **397s (6.6 min)** |
| Stations with crossings in 24h | 25 |
| Median of per-station medians (24h) | 11,633s (193.9 min) |

**Why the 1h18m figure looked inconsistent:**  
The original Q2c query measured gaps across **all 4,071 crossing events all-time**, not within a 24h window. The all-time global median gap is 4,655s (1h18m) because it spans quiet periods (overnight, gaps between DJ sets). Within any 24h the global median gap drops to 6.6 min because 25 stations are running in parallel.

The per-station view (median of medians = 193.9 min) is correct: within a single station, library crossings are ~3h apart on average. But across all stations simultaneously, a crossing arrives roughly every 7 min.

### Median library user

The median library size is **1 item** across 30 users. Users with 1–2 items have **0 crossings** in both the 24h and 7d windows against the current station set.

**Implication for Task B (detent design):**  
- Per-crossing detents for a heavy user = ~9 per hour. Far too dense for coarse sweep. **Run-level coarse detents are validated.**  
- Window by count (not time) is essential: the interface must degrade gracefully to zero crossings without crashing or showing stale state.  
- Chosen constants (state in code comments): coarse window N_RUNS = 50 runs, fine window N_CROSSINGS = 200 crossing moments. These cover the heavy user (39 runs all-time) with headroom and produce an empty state for median users without special-casing.

---

## Q2 — KEXP duration diagnosis

### Branch determination: **recordings rows EXIST with null `duration_ms`**

| Category | KEXP count | KEXP % | SomaFM Folk Forward % |
|----------|-----------|--------|----------------------|
| `has_duration` | 325 | 48.3% | 94.0% |
| `row_exists_duration_null` | 348 | **51.7%** | 6.0% |
| `recording_row_missing` | 0 | 0% | 0% |

No missing rows. The fix is a **MusicBrainz duration backfill**, not a re-resolution of KEXP spins.

### Clustering by `created_at`

All 673 KEXP MBID-resolved spins in the DB are from **2026-Q3** (one quarter). There is no historical era split — KEXP is a recent addition. The 51.7% null-duration rate reflects recordings created during the initial KEXP ingestion before duration was fetched, not a degraded historical backfill.

### Backfill job size

**274 distinct recording MBIDs** have an existing `recordings` row with `duration_ms IS NULL` on KEXP spins. At MusicBrainz 1 req/sec this is approximately **5 minutes** of wall time — a trivial backfill.

**Branch conclusion for Task #1524:** Proceed with the MusicBrainz backfill job. Do not investigate the ingest path.

---

## Q3 — Coverage signal audit

### Available signals

| Signal | Table | Type | Coverage use? |
|--------|-------|------|---------------|
| `last_success_at` | `radio_browser_stations` | Current state | ❌ Not historical |
| `consecutive_errors` / `icy_status` | `radio_browser_stations` | Current state | ❌ Not historical |
| `last_alive_at` | `stations` | Current state | ❌ Not historical |
| `active` / `health_failures` | `stations` | Current state | ❌ Not historical |
| Spin arrival cadence | `spins.played_at` | Historical | ⚠️ Ambiguous (see below) |

### Spin-arrival proxy — top 20 stations, last 30 days

| Station | Total hours | Hours with ≥1 spin | % covered (proxy) |
|---------|------------|--------------------|--------------------|
| KEXP 90.3 FM | 721 | 588 | 81.6% |
| Nostalgie New York | 721 | 337 | 46.7% |
| SomaFM Underground 80s | 721 | 332 | 46.0% |
| (other top-20 stations) | 721 | 263–330 | 36–46% |

### Why spin cadence is not reliable for coverage

A station-hour with **zero spins** is ambiguous:
1. Lore wasn't polling → genuine coverage gap
2. Lore was polling, station had long between-track gaps (talk, ads) → not a gap
3. Lore was polling, station was playing music, metadata was blank → not a gap

No historical polling log exists (no per-poll audit table, no watcher event log, no per-hour enrollment record). The current `radio_browser_stations.last_success_at` and `stations.last_alive_at` are overwritten on every update and do not preserve history.

### Coverage conclusion: **Coverage is NOT derivable from existing data**

Drawing a density spine bin as "zero crossings, covered" would fabricate a fact about whether Lore was actually listening. It cannot be distinguished from a coverage gap without a historical poll log.

**A dedicated coverage log table would be required:**
- Grain: `(station_id, hour_start)` with a boolean `polled` flag
- Population: the ICY watcher and polling loop would write a row (or upsert) for each hour they complete at least one successful fetch attempt
- This is new infrastructure and out of scope for the current task chain

**Consequence for Task #1520 (density spine):**  
Every empty bin **must render as the "not covered / unknown" texture**. Never as "covered, nothing crossed." The absence of spins in an hour is not positive evidence of silence — it is simply unknown.

---

## Summary decisions for downstream tasks

| Task | Decision |
|------|----------|
| **#1520 density spine** | All empty bins render as "unknown" (hatch/dim). No "silence" state is derivable. |
| **#1521 detent design** | Coarse = runs, N_RUNS=50. Fine = crossings, N_CROSSINGS=200. Window by count. |
| **#1521 density** | 25 stations active in 24h for heavy user, ~7 min global median crossing gap. Per-crossing detents are untenable. |
| **#1524 KEXP backfill** | Recordings rows exist with null duration. Backfill 274 MBIDs from MusicBrainz. ~5 min wall time. |
| **Median user** | 0 crossings typical. Dial must handle zero-result state cleanly without special-casing. |
