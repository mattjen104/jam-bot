---
name: Credit discovery boundaries
description: Scope, identity, and query-cost rules for public credit paths.
---

Recording personnel and works remain attached to recordings; release labels and edition facts remain attached to releases. Album pages may present both, but must not promote track personnel into album personnel.

**Why:** Music credits cross recording, work, release-group, release, label, and artist entities. Collapsing those scopes makes a valid fact misleading. Name-based guesses also create incorrect discovery paths.

**How to apply:** Link only canonical MusicBrainz identities. Public discovery must disclose that it covers Lore's indexed corpus, paginate by stable credit identity, bound nested memberships/facts, and use indexed relationship joins before pagination. When a filter matches an identity beyond a display cap, prioritize that exact identity in the bounded projection.