---
name: Full Archive overlap scans
description: Why full-library Live Music Archive checks are session-bound background work.
---

Run whole-library Archive overlap as an explicit, read-only background scan in the listener's own session; report progress and partial external failures honestly.

**Why:** The former 24-artist synchronous sample could not answer whether the rest of a listener's library matched, while a whole-library HTTP request could time out. An agent's shell or preview has a different device identity and cannot stand in for the listener's private Library.

**How to apply:** Do not claim an anonymous preview's empty result represents the user's library. Keep scans user-scoped, bounded in concurrent Archive requests, and expose checked-versus-total counts while the scan continues after navigation. A server restart can discard in-memory scan state; do not pretend that means a complete zero-result report.