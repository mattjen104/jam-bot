---
name: Global scan test fixtures
description: How to assert integration tests for background jobs that scan shared global tables.
---

Global-scan job tests must assert their own fixtures' effects and relative batch invariants, not a fixed total row count.

**Why:** The shared development database can legitimately contain seeded or concurrently created rows outside a test's fixture. A global job sees all eligible rows, so absolute expectations make correct behavior flaky.

**How to apply:** Use unique fixture identifiers, verify their exact state transitions and calls, then assert relationships such as `probed === total` and expected counts relative to known successful fixtures.