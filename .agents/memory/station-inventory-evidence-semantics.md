---
name: Station inventory evidence semantics
description: Rules for honest station quality and category diagnosis in operator inventory.
---

Treat absent quality computation, a successfully computed but insufficient sample, and a failed recomputation as separate states. A first-ever failure must not create default score values or a synthetic computation timestamp; a later failure may preserve the last successful score and report failure through its dedicated status.

**Why:** Operator rankings become misleading when missing evidence is represented as a measured low score, or when a valid prior score is relabeled “unscored” because a later refresh failed.

**How to apply:** Keep category affiliation explicit, expose operational evidence in dedicated fields, and let action queues combine missing/stale/unhealthy signals without collapsing them into the quality tier.