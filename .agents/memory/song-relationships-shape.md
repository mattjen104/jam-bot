---
name: Song-to-song relationships shape
description: Where typed MusicBrainz relationships (samples/covers/remixes/interpolations) live in the enrichment bundle and why.
---

Typed song-to-song relationships (sample/cover/remix/interpolation, each forward+backward) live as `relationships: SongRelationship[]` ON `TrackKnowledge` (recording-level) in `@workspace/song-enrichment`, not as a separate context field.

**Why:** TrackKnowledge already rides the shared knowledge bundle gated by `trackKnowledgeEnabled()` and is consumed by BOTH the Slack track card and the web `/song` API. Putting relationships there lights up both surfaces with one change and reuses the existing MusicBrainz recording-id spine.

**How to apply:**
- Parser is pure `parseSongRelationships(body, cap=12)` over a MusicBrainz `relations[]` array; works for both recording-rels and work-rels bodies. `classifyRelKind` is substring-based (sampl/remix/cover/interpolat|based on). Direction taken verbatim from MB; human `label` derived from kind+direction via `REL_LABELS`. Only relations with a usable target (id+title) survive; deduped by `kind|direction|targetId`.
- The field is REQUIRED in the TS interface but treat it as possibly-absent at every read site (`k.relationships?.length ?? 0`) because old cache entries predate it. In OpenAPI it is OPTIONAL (not in `required`) for the same reason.
- Slack rendering: shared `relationshipLines()` in knowledge.ts produces the grouped ":link: *Connections*" mrkdwn; the card's liner-notes section only renders when real personnel/pressing exist, otherwise just the Connections section shows.
- Web graph FRONTEND rendering is a SEPARATE task; this backend only guarantees the shape in the bundle + OpenAPI.
