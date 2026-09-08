# Lore cheap playlist coverage findings

Generated from the development inventory on 2026-09-08. The machine-readable
report and station rows are in `lore-playlist-coverage.json`; append-only network
evidence is in `lore-playlist-coverage-evidence.jsonl`.

## Fleet denominator

The snapshot contained 874 station records. After mutually exclusive
classification, 500 were eligible: active, visible, non-test, non-duplicate,
and backed by a sanctioned stream or configured metadata source.

| Excluded class | Stations |
| --- | ---: |
| Test or placeholder | 36 |
| Duplicate | 9 |
| Inactive | 192 |
| Hidden | 79 |
| Unsupported / no probe target | 58 |

## Coverage bounds

| Bound | Stations | Eligible fleet |
| --- | ---: | ---: |
| Confirmed usable artist/title evidence | 327 | 65.4% |
| Conservative (confirmed + configured permitted metadata) | 459 | 91.8% |
| Potential (adds unprobed and transient outcomes) | 463 | 92.6% |

The gap between confirmed and potential is 136 stations. It is uncertainty, not
claimed coverage.

Only 1 station in this snapshot had both positive evidence and a configured
time-anchored, resumable history contract. Another 326 had comparison-usable
artist/title observations but are classified as live-only. Separately, 185
stations had evidence that audio was reachable without that fact being counted
as playlist coverage. Schedule evidence existed for 327 stations and contributed
nothing to the playlist numerator.

## Pilot and load

The proportional stratified pilot selected 47 stations (roughly 10% of the
eligible fleet) across source, geography, schedule, and prior-evidence strata.
It found usable artist/title pairs for 24 of 47 (51.1%); the Wilson 95% interval
is reported in the machine-readable findings. The pilot then expanded
into a stable 75-station fleet batch. Of those 75, 33 were skipped
because the append-only ledger showed they had already been probed that day;
42 new operations ran.

Across the initial pilot, expansion batch, and corrected proportional pilot,
the ledger retains every evidence and reuse annotation. The current per-station
snapshot covers 142 stations:

- 73 usable artist/title pairs
- remaining outcomes are broken down without coercion in the JSON report

Median latest-evidence latency was 2.4 seconds and p95 latency was 7.1 seconds. Every row
records zero mutations. No Spinitron HTML, schedule page, fingerprinting, or
continuous audio capture was used.

The cumulative conservative request upper bound is 974 requests across 142
station evidence snapshots. This deliberately treats legacy ICY observations
as seven requests each; accounting-version-2 probes avoid the redundant second
redirect chain and are bounded at four. Host totals are requested origins, not
redirect destinations, because redirect targets are not retained.

## Interpretation

The confirmed figure is the defensible lower bound. The conservative and
potential figures are planning bounds, not promises: configured sources can be
stale, and one live observation cannot prove continuous availability or complete
history. Transient failures should be rechecked in a later daily window; policy
rejections and metadata-negative results remain separate from those failures.