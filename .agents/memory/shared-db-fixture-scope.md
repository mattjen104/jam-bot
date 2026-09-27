---
name: Shared DB fixture scope
description: Keep station-specific integration tests bounded in a long-lived shared database.
---

Station-specific integration tests should scope sync operations to their fixture, including repeated idempotency calls. Do not accidentally exercise a catalog-wide run while asserting only one fixture.

**Why:** A full-catalog sync can take longer than an integration test's timeout against a long-lived shared database. Extending the timeout would conceal a test-isolation error.

**How to apply:** Scope integration sync calls to the fixture being asserted. Preserve the unscoped production path; test it separately only when whole-catalog behavior is the subject.