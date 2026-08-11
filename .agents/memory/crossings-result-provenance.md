---
name: Crossings result provenance
description: Any "nothing matched" claim must be gated on a settled server result, never on a client-side timeout.
---

Rule: a definitive negative claim ("none of your artists played") may only render from a genuine settled server result. A bounded client-side wait expiring is NOT evidence of emptiness — degrade to honest in-progress copy, and to a terminal "couldn't check" state if computing stalls or the compute crashed.

**Why:** the dial once showed a false "nothing played today" whenever the 25s skeleton bound expired while the server was still computing crossings; a crashed background compute could also masquerade as a settled empty result or an eternal computing state.

**How to apply:** server single-flight computes must record failures (cleared only on a successful cache write) and answer a retryable `failed` flag — including on the timed-out-waiting path — never a bare empty result. Client-side, gate empty states on the settled phase, not on loading flags. "Settled" additionally requires an actual response in hand (`hasResult`): a non-pending query with no data (paused offline, pre-fetch mount window) must read as loading, never settled-empty.
