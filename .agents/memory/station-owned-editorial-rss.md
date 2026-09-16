---
name: Station-owned editorial RSS
description: Identity and evidence rules for connecting Press publications to Lore stations and shows.
---

Keep RSS transport identity, publication identity, station identity, and optional show identity separate. Connect them only with an explicit reviewed ownership record and a public evidence URL. Do not infer ownership from similar handles, slugs, names, feed hosts, or existing curator aliases.

**Why:** Those identifiers belong to different namespaces and may legitimately diverge. Overloading one as another creates false attribution and makes later feed changes unsafe.

Ownership enrollment must preflight the complete reviewed batch and serialize concurrent claims on publication identity before writing. Feed identity must come from one canonical manifest shared by production seeding and real-feed validation.

**Why:** A read-then-upsert ownership claim can overwrite a concurrent different owner, and duplicated live-test URLs can pass while production seeds drift.

**How to apply:** Validate the live endpoint as RSS/Atom first, seed the publication independently, then atomically seed ownership to an existing exact station. When supplied, verify the show belongs to that station. Treat capitalization and generic editorial words as insufficient music evidence without explicit music metadata.