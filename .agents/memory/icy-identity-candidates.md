---
name: ICY identity candidate boundary
description: How possible show/DJ text from ICY metadata must be retained without becoming identity.
---

Retain rejected raw ICY metadata consistently across watcher and fallback-poller paths, but keep it in a bounded observational store. A title or host-like string is only a candidate; it must never create a spin, show, DJ, picker, or show attribution by itself.

**Why:** Music-oriented ICY filtering correctly rejects title-only and programming metadata, but that same rejection can erase useful show/DJ evidence. Retention and identity promotion therefore need separate provenance boundaries.

**How to apply:** Classify and retain raw metadata before returning from the music filter. Deduplicate and expire candidates, expose them for operator review, and require independent grounded evidence before promotion.