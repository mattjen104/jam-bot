---
name: MB ISRC endpoint parameter bug
description: The MB /isrc/{isrc} endpoint does NOT accept inc=recordings — it returns an error JSON that silently yields null in the resolver.
---

The correct MusicBrainz ISRC endpoint URL is:
  `/isrc/{isrc}?fmt=json`

**NOT** `/isrc/{isrc}?inc=recordings&fmt=json`.

The `inc=recordings` parameter is invalid for the isrc resource. MB responds with:
  `{"error": "recordings is not a valid inc parameter for the isrc resource."}`

`parseIsrcRecordingId` sees no `recordings` field in that error body and returns null — silently, because the try/catch wraps the whole call.

**Why:** The isrc endpoint always includes recordings in its response by default. The `inc=recordings` syntax is only valid on recording/release/artist resources.

**How to apply:** Any `/isrc/` endpoint call must omit `inc=recordings`. Only `fmt=json` is needed. Affects both `createMbResolver().resolveByIsrc` and the standalone `resolveRecordingId` function in musicbrainz.ts.
