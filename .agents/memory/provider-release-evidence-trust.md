---
name: Provider release evidence trust
description: Trust and reconciliation rules for pre-MusicBrainz release-date evidence.
---

Shared provider release evidence must come from a server-verified exact provider
track identity. Browser-supplied Apple Music metadata may support that listener's
local Library view, but it must not become global recording metadata without
server-side catalog verification.

**Why:** Release evidence can later fill canonical recording fields. Treating
client-supplied metadata as globally trusted lets one listener poison metadata
seen by everyone.

**How to apply:** Reconcile through an unambiguous strong identifier such as a
locally unique ISRC. Make canonical linkage atomic. If a provider track is
already linked elsewhere, reject the new link without changing any part of the
retained evidence packet.