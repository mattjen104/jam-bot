---
name: Blended first-play cache compatibility
description: Keeping global/blended Dial crossing data consistent when aggregate fields change.
---

When adding a new station-level aggregate to personal crossings, add it to the blended/global rolling and lifetime queries too. A blended L2 cache row that predates the field must be treated as a cache miss rather than rendered with a client-side zero.

**Why:** The UI can select the same score and scope in personal or blended mode. Missing cached fields otherwise look like genuine zeroes, producing a misleading all-tie sort until cache expiry.

**How to apply:** Extend both query families, return complete fields in the merged result, and validate the L1/L2 blended cache shape before serving it. Test a fresh legacy cache row as well as the new aggregate's earliest-occurrence attribution.