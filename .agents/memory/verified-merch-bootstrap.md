---
name: Verified merch bootstrap and DNS pinning
description: Durable population and network-compatibility rules for the verified artist-merch collector.
---

The merch collector must start from a small reviewed roster of canonical artist MBIDs and verified artist-owned source URLs. Never derive or guess storefront URLs from artist names.

**Why:** The collector is intentionally unable to discover sources itself. A migrated database with no reviewed targets stays permanently empty even though the route and poller are healthy.

**How to apply:** Seed reviewed targets idempotently before long unrelated boot work, then let the background collector validate and refresh products. Expand the roster only with explicit identity evidence.

Custom DNS lookup callbacks must support both Node callback shapes: return one address for normal lookup and an array of address objects when `options.all` is true.

**Why:** Modern Node connection logic may request all addresses. Returning the scalar legacy shape in that branch becomes an undefined socket address before the HTTPS request is opened.

**How to apply:** Preserve TLS hostname/SNI while pinning validated public DNS results, and test both scalar and all-address callback paths.