---
name: Schedule attribution withdrawals
description: Rules for withdrawing scraped schedule evidence without rewriting archived spins.
---

Void schedule evidence in place and keep the audit receipt. Attribution queries must distinguish
schedule-derived DJ pickers from directly curated pickers, exclude voided matching blocks, and still
allow a valid overlapping block to provide attribution.

**Why:** A scraped schedule can be structurally valid but wrong; deleting rows or mutating spins
would destroy the evidence trail and make later correction opaque.

**How to apply:** Reuse the shared attribution predicate on every archive, player, picker, share,
and derived-read-model surface; invalidate schedule-dependent caches after a void.