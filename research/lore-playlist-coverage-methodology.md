# Lore cheap playlist coverage audit

Run from the repository root:

```sh
# Read-only inventory report; no external requests
pnpm --filter @workspace/api-server audit:playlist-coverage

# Stratified pilot (roughly 10%, capped by --limit)
pnpm --filter @workspace/api-server audit:playlist-coverage -- --pilot --probe --limit=75

# Resumable full-fleet batches after reviewing the pilot
pnpm --filter @workspace/api-server audit:playlist-coverage -- --probe --limit=75 --after-id=<nextAfterId>
```

The JSON report defines the mutually exclusive cohort exclusions and the
confirmed, conservative, and potential evidence thresholds. Network evidence is
append-only JSONL. That ledger supplies the once-per-station daily guard and
allows interrupted runs to resume without repeating requests.

The audit never calls repair, enrollment, polling, or operational persistence
paths. ICY requests use the existing bounded GET-based, public-IP-pinned,
redirect-limited client and per-origin pacing. Radiojar uses its official public
JSON endpoint. Spinitron pages, schedule pages, fingerprinting, and continuous
audio capture are not audit targets. Schedule presence is only an independent
annotation and cannot increase playlist coverage.

Request accounting reports a conservative upper bound. Current audit ICY probes
perform one redirect-resolution chain (at most four requests). Evidence created
before accounting version 2 may have performed a second chain; superseding
append-only correction rows conservatively record seven requests for those
observations. Origin totals are explicitly requested origins because redirect
targets are not retained.