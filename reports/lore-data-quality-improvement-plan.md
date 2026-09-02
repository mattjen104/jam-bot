# Lore Station Data Quality Improvement Plan

**Date:** September 2, 2026  
**Goal:** Produce enough fresh, grounded musical evidence to write a useful listener-facing sentence for most actively curated stations.  
**LLM status:** Explicitly deferred. No classification or generation model belongs in the data path covered by this plan.

## Outcome targets

For the 43-station front-door roster:

- 95% of stations have a verified metadata source or an explicit unsupported reason.
- Every configured active source produces a usable track pair within 24 hours or raises a visible source-quality failure.
- At least 90% of clean track-shaped pairs resolve to a canonical MusicBrainz recording or a clearly labeled provider identity.
- At least 80% of recently resolved recordings have nonempty genre evidence.
- At least 35 of 43 stations have enough fresh breadth and enrichment for a useful sentence.
- No sentence is produced from missing, stale, placeholder, show-only, or unsupported evidence.

For the 509-station normal directory, coverage is reported separately. Long-tail stations without a reliable metadata source must remain honestly unsupported rather than inheriting generic copy.

## Data funnel

Every station should be measurable through the same stages:

1. Configured and enrolled
2. Poll attempted
3. Source responded
4. Metadata present
5. Metadata classified as a usable artist/title pair
6. Recording resolved
7. Genre/year enrichment attempted
8. Genre/year evidence found
9. Recent station profile computed
10. Station passes the sentence-readiness gate

Aggregate spin volume must never substitute for per-station funnel coverage.

## Phase 1 — Make resolution retry-safe

### Work

- Preserve transient MusicBrainz failures as retryable rather than permanently caching them as clear misses.
- Give historical unmatched spins the same single bounded artist/title reversal used by live ingestion.
- Select the highest-scoring MusicBrainz recording explicitly rather than trusting response ordering.
- Keep the raw source fields unchanged and preserve conservative duration rejection.
- Version resolver behavior before introducing broader normalization so old permanent misses cannot silently block a corrected algorithm.

### Measures

- Clear misses remain cached and do not hammer MusicBrainz.
- Network, rate-limit, and provider failures enter the deferred queue.
- Reversed historical metadata can converge without unbounded extra requests.
- Direct high-confidence matches still use one MusicBrainz query; only clear misses use the second bounded query.

### Current status

Started in the first implementation slice:

- Status-aware live text resolution now preserves transient failures for retry.
- Historical unmatched-spin recovery now performs one bounded swap.
- Recording search now selects the highest-scoring result with a deterministic tie-break.
- Focused resolver and backfill tests cover these behaviors.

## Phase 2 — Measure and repair source capture

### Work

- Reuse one pure metadata-quality classifier across probes and normal polling.
- Record distinct outcomes: response error, empty metadata, junk/placeholder, incomplete pair, usable pair, and written spin.
- Persist per-station/source last attempt, last response, last usable pair, and rolling outcome counts so restarts do not erase operational truth.
- Keep source capability separate from runtime health:
  - complete history
  - current-track API
  - persistent ICY watcher
  - interval-only stream
  - unsupported/no source
- Prioritize the 43 front-door stations for source-specific repair.
- Add official now-playing/history adapters when a stream does not carry usable ICY metadata.
- Do not attempt identity resolution for station IDs, show names, ads, backup labels, or placeholders.

### Measures

- 95% of the front-door roster is `healthy` or `recoverable`.
- Zero unexplained `never seen` stations after 24 hours.
- At least 90% usable-pair rate for sources expected to emit track metadata.
- Source failures are attributable to a station, adapter, and outcome rather than appearing only as absent spins.

## Phase 3 — Improve deterministic metadata normalization

### Work

- Build a small, versioned set of conservative query variants for clean raw metadata.
- Support known source-specific field ordering and presentation suffixes.
- Strip only clearly presentational suffixes such as official-video markers; do not broadly remove parentheses or punctuation that distinguish recordings.
- Cache by source/raw input plus resolver algorithm version.
- Preserve every raw field for audit and parser regression testing.
- Assemble a manually reviewed fixture set from real ICY, Spinitron, station-page, talk, ad, and placeholder examples.

### Measures

- At least 95% precision when admitting a value as a music track.
- Fewer than 2% of show, ad, station-ID, and placeholder values reach MusicBrainz.
- At least 90% exact artist/title ordering on the reviewed fixture set.

## Phase 4 — Prioritize recent enrichment fairly

### Work

- Expose a genre-enrichment health funnel equivalent to the existing release-year health report.
- Separate:
  - never attempted
  - transient failure
  - definitive no-result
  - genre data found
  - ineligible synthetic/provider-only identity
- Prioritize recordings heard recently on active front-door stations.
- Add per-station fairness so one high-volume station cannot consume each enrichment batch.
- Preserve sequential provider pacing and existing rate-limit protection.
- Keep definitive empty results from retrying forever, but never mark transient provider failures as completed.
- Enrich recent evidence first; do not wait for the full historical recording table to converge.

### Measures

- 95% of eligible recent recordings attempted.
- At least 80% of recent resolved recordings with nonempty genre evidence.
- Visible oldest-pending age and recent throughput.
- No starvation of lower-volume front-door stations.

## Phase 5 — Compute recent station profiles

### Work

- Create a listener-facing 90-day profile separate from cumulative all-time insights.
- Add a 30-day freshness signal.
- Store the profile window, sample size, unique tracks, unique artists, resolution rate, genre coverage, dated-track coverage, top supported genres, and update timestamp.
- Reject polluted artist values and unsupported genres before aggregation.
- Recompute when enough new evidence arrives rather than on every spin.
- Keep existing cumulative profiles where they serve archive or discovery uses.

### Current status

- The insights worker now stores a separate rolling 90-day fact packet for every active station while preserving the cumulative archive profile.
- A separate rolling 30-day freshness signal records whether any clean, usable artist/title evidence remains current.
- Sample size, resolved count, unique track and artist breadth, resolution rate, genre and release-date coverage, exclusions, supported genres, and update timestamps are persisted.
- The ready/provisional/insufficient tier is computed only from those stored facts. Station IDs, show/DJ labels, placeholders, URLs, and unsupported genre values are excluded before aggregation.

### Readiness gate

A station is ready only when it has:

- At least 50 resolved recent spins
- At least 40 unique resolved tracks
- At least 30 unique artists
- Sufficient genre-tagged support for every named genre
- A recent usable spin
- No material station/show/placeholder contamination

Music-only provisional copy may use a stricter wording template, but must still have a representative recent sample.

## Phase 6 — Operational accountability

### Work

- Add one admin data-funnel view covering source capture, resolution, enrichment, and sentence readiness.
- Show both counts and percentages; station-level rows must be inspectable.
- Persist last success and attempt timestamps rather than relying only on in-memory health state.
- Alert on source silence, usable-pair collapse, resolver queue stagnation, enrichment queue age, and sudden coverage regressions.
- Snapshot the readiness report daily so improvements and regressions can be measured.

### Measures

- Operators can explain every excluded front-door station from one report.
- Restarts do not erase the last known source or enrichment state.
- The ready-station count is reproducible from stored facts.

## Deferred LLM layer

No LLM integration is included in Phases 1–6.

If reconsidered later, an LLM may classify genuinely ambiguous metadata or phrase an already verified fact packet. It must not overwrite raw metadata, assign canonical recording identity, invent genres, or create evidence for a station with no usable source.

## Recommended delivery sequence

1. Retry-safe resolver and historical convergence
2. Persistent source-quality funnel
3. Source-specific repairs for the front-door roster
4. Conservative versioned normalization
5. Fair recent-recording enrichment
6. Recent 90-day station profiles
7. Unified admin readiness report
8. Editorial sentence review

Each stage should improve measurable station coverage before the next begins.