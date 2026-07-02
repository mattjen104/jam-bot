---
name: Classic Albums series integration
description: Series picker + transcript→claims pipeline — caption availability reality, multi-list segue grouping, OpenAPI enum sync traps.
---

## Caption availability (as of Jul 2026)
Mercury Studios (official Classic Albums channel) has captions DISABLED on all
uploads — every per-track clip and trailer probed had zero caption tracks. The
only captioned official Classic Albums video found is the Pink Floyd DSOTM
trailer (en:asr), which is album-level, not track-mappable. Unofficial rips are
banned by policy.
**How to apply:** the claims pipeline is live but dormant; seeded clips stay
unprocessed (`clipProcessed` false) so the poller auto-ingests the moment
captions appear. Don't re-sweep YouTube expecting captioned per-track clips.
The extraction+grounding path WAS validated end-to-end on the trailer captions
(dry-run): grounding guard correctly rejected an unsupported claim.

## Multi-list pickers must scope adjacency to the list
A picker holding several ordered lists (series' albums, show's episodes) has
ordinals restarting at 1 per list. Deriving rideable edges by picker+ordinal
alone interleaves lists on tied ordinals and forges cross-album segues.
**Fix:** group adjacency by (pickerId, listKey) where listKey = externalId
minus its last `:`-segment (`classicalbums:{slug}`, `nts:{episode}`); constant
prefixes (label roster `label:{mbid}:{recId}`) collapse to one chain, which is
correct. See `pickListKey` in segue.ts.

## New enum member = update OpenAPI too
Adding a rung/pickerType/source value to server TS types is not enough — the
OpenAPI enums must be extended and codegen re-run, or the route's zod response
`.parse` rejects live data. Symptom trap: the ZodError thrown crashes Node's
`console.error` inspect (`TypeError ... reading 'value'` in formatProperty), so
the log shows the inspect crash instead of the real validation error.
