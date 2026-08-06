---
name: Dial ranged coarse-scan window
description: Time-bounded runs query needs a played_at-leading index; UI range pills default 2d.
---
The dial's time-travel range (2d/1w/1m pills) feeds a `days` param into the recent-runs query, which filters spins purely by `played_at >= now() - interval`.

**Why:** all pre-existing spins indexes lead with mbid/station_id/show_id, so a time-only predicate seq-scans the ~1M-row table. A boot migration adds `spins_played_at_idx (played_at)`; keep it if the query shape changes (verified ~160ms index-only scan for 30d).

**How to apply:** any new endpoint filtering spins by time alone should rely on that index; limits scale with the window (120/200/300) and stay bounded. The DensitySpine goes "dense" (no gap/min-width) above 60 runs to avoid overflow clipping; `usePastScanState` clamps coarseIdx via a plain effect (no nested setters) when the run list shrinks.
