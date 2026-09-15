---
name: Reviewed station profiles
description: Editorial ownership and API boundaries for researched station descriptions.
---

Reviewed station profiles are a code-owned editorial dataset with a concise card summary, a longer profile, source links, and a review date. Scraped homepage blurbs remain best-effort fallback copy only and must not overwrite reviewed material.

**Why:** Homepage metadata is often generic, unstable, or promotional. Reviewed profiles need durable provenance and claim control, while the station directory must avoid carrying every long description in its general list payload.

**How to apply:** Use the reviewed summary wherever the existing card blurb is expected. Expose the long profile and provenance only on station-detail responses. Keep unreviewed stations on the scraped fallback, and preserve source URLs and review dates when revising copy.