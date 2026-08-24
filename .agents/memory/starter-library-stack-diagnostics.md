---
name: Starter-library vs Stack diagnostics
description: How to distinguish a successful Matt starter-library copy from a compact Stack client failure.
---

When diagnosing starter-library onboarding, treat the copy, the library read model, and the compact Stack render as separate stages. A successful starter status and copy response does not prove the Stack has rendered.

**Why:** Under a busy development API, the browser’s generated `useMyLibraryInfinite` request timed out while direct `GET /api/me/library?limit=100` succeeded quickly. The Feed can therefore be correct and the copy present while the Stack shows its retry state.

**How to apply:** Confirm the starter status and copy responses, then inspect the compact Stack query state separately. Check the exact generated-query endpoint with its normal page size before attributing an empty or retrying Stack to the starter data.