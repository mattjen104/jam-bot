---
name: Device-local station follows
description: Product boundaries and migration semantics for listener station follows.
---

Listener station follows are a device-local preference shared by Now, Explore, Scan, and station surfaces. They cover curated stations and listener-added directory stations through the same identity model. Adding a directory station follows it; removing that personal station also unfollows it. Existing personal stations are adopted when the versioned follow store is first established.

**Why:** A lightweight returning-listener preference must not be confused with operator curation or saved music, and upgrading must preserve intent already expressed through pins and personal stations.

**How to apply:** New station-facing listener surfaces should read the shared local follow state. Never use follows to set editorial `favorite`, create Library items, change station discovery/curation, or enroll pollers. Quiet and temporarily unattributed followed stations remain visible.