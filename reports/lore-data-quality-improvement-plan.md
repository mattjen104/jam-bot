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

- Add one admin data-funnel view covering source capture, resolution, enrichment, and sentence readiness.
- Show both counts and percentages; station-level rows must be inspectable.
- Persist last success and attempt timestamps rather than relying only on in-memory health state.
- Alert on source silence, usable-pair collapse, resolver queue stagnation, enrichment queue age, and sudden coverage regressions.
- Snapshot the readiness report daily so improvements and regressions can be measured.

### Measures

- Operators can explain every excluded front-door station from one report.
- Restarts do not erase the last known source or enrichment state.
- The ready-station count is reproducible from stored facts.


### Operational contract

- The backfill reserves a bounded recent slot per active, visible,
  crossing-eligible station before filling the rest of the batch from the
  global recent-first queue.
- Provider calls remain sequential. Retryable failures cool down before
  re-entering the queue; definitive empty results do not retry.
- Synthetic Spotify recording identities are classified as ineligible and
  never sent to MusicBrainz genre lookup.
- `/api/admin/genre-enrichment-health` reports the five-state recording funnel,
  30-day attempted/genre coverage, oldest pending evidence, 24-hour throughput,
  and per-station coverage for the front-door roster.

### Current status

- The insights worker now stores a separate rolling 90-day fact packet for every active station while preserving the cumulative archive profile.
- A separate rolling 30-day freshness signal records whether any clean, usable artist/title evidence remains current.
- Sample size, resolved count, unique track and artist breadth, resolution rate, genre and release-date coverage, exclusions, supported genres, and update timestamps are persisted.
- The ready/provisional/insufficient tier is computed only from those stored facts. Station IDs, show/DJ labels, placeholders, URLs, and unsupported genre values are excluded before aggregation.

## Phase 2 — Measure and repair source capture

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


### Operational contract

- The backfill reserves a bounded recent slot per active, visible,
  crossing-eligible station before filling the rest of the batch from the
  global recent-first queue.
- Provider calls remain sequential. Retryable failures cool down before
  re-entering the queue; definitive empty results do not retry.
- Synthetic Spotify recording identities are classified as ineligible and
  never sent to MusicBrainz genre lookup.
- `/api/admin/genre-enrichment-health` reports the five-state recording funnel,
  30-day attempted/genre coverage, oldest pending evidence, 24-hour throughput,
  and per-station coverage for the front-door roster.

## Phase 3 — Improve deterministic metadata normalization

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


### Operational contract

- The backfill reserves a bounded recent slot per active, visible,
  crossing-eligible station before filling the rest of the batch from the
  global recent-first queue.
- Provider calls remain sequential. Retryable failures cool down before
  re-entering the queue; definitive empty results do not retry.
- Synthetic Spotify recording identities are classified as ineligible and
  never sent to MusicBrainz genre lookup.
- `/api/admin/genre-enrichment-health` reports the five-state recording funnel,
  30-day attempted/genre coverage, oldest pending evidence, 24-hour throughput,
  and per-station coverage for the front-door roster.

## Phase 4 — Prioritize recent enrichment fairly

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


### Operational contract

- The backfill reserves a bounded recent slot per active, visible,
  crossing-eligible station before filling the rest of the batch from the
  global recent-first queue.
- Provider calls remain sequential. Retryable failures cool down before
  re-entering the queue; definitive empty results do not retry.
- Synthetic Spotify recording identities are classified as ineligible and
  never sent to MusicBrainz genre lookup.
- `/api/admin/genre-enrichment-health` reports the five-state recording funnel,
  30-day attempted/genre coverage, oldest pending evidence, 24-hour throughput,
  and per-station coverage for the front-door roster.

## Phase 5 — Compute recent station profiles

### Work

- Add one admin data-funnel view covering source capture, resolution, enrichment, and sentence readiness.
- Show both counts and percentages; station-level rows must be inspectable.
- Persist last success and attempt timestamps rather than relying only on in-memory health state.
- Alert on source silence, usable-pair collapse, resolver queue stagnation, enrichment queue age, and sudden coverage regressions.
- Snapshot the readiness report daily so improvements and regressions can be measured.

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


### Operational contract

- The backfill reserves a bounded recent slot per active, visible,
  crossing-eligible station before filling the rest of the batch from the
  global recent-first queue.
- Provider calls remain sequential. Retryable failures cool down before
  re-entering the queue; definitive empty results do not retry.
- Synthetic Spotify recording identities are classified as ineligible and
  never sent to MusicBrainz genre lookup.
- `/api/admin/genre-enrichment-health` reports the five-state recording funnel,
  30-day attempted/genre coverage, oldest pending evidence, 24-hour throughput,
  and per-station coverage for the front-door roster.

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
