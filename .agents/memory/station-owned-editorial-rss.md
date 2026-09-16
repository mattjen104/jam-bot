---
name: Station-owned editorial RSS
description: Identity and evidence rules for connecting Press publications to Lore stations and shows.
---

Keep RSS transport identity, publication identity, station identity, and optional show identity separate. Connect them only with an explicit reviewed ownership record and a public evidence URL. Do not infer ownership from similar handles, slugs, names, feed hosts, or existing curator aliases.

**Why:** Those identifiers belong to different namespaces and may legitimately diverge. Overloading one as another creates false attribution and makes later feed changes unsafe.

**How to apply:** Validate the live endpoint as RSS/Atom first, seed the publication independently, then seed the ownership relation to an existing station and, when supplied, verify the show belongs to that station. WWOZ is the first reviewed production example.