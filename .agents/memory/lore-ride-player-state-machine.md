---
name: Lore ride player state machine
description: Correctness rules for the "ride the picker" queue-driven audio player so async preview resolution and lookahead never corrupt playback.
---

# Lore ride player — queue-driven playback correctness

The ride player holds a `queue` of items and plays 30s iTunes preview clips for
the current index. Two classes of bug are easy to reintroduce here; both are
about how the playback effect and its async work relate to the queue.

## Rules
1. **Depend on the current item's identity, not the whole `queue` array.** The
   playback `useEffect` must key off `currentMbid` + `currentPreview` (derived
   from `queue[index]`), never `[..., queue]`. Lookahead appends the *next* hop
   to the queue; if the effect depends on the whole array it re-runs and
   restarts the clip that is already playing.
2. **Guard the actual `audio.src`/`load`/`play` behind a URL-changed check.**
   Keep a `playingUrlRef`; only (re)load when `playingUrlRef.current !== currentPreview`.
   Belt-and-suspenders against any extra re-run (StrictMode double-invoke, etc.).
3. **Patch async preview results BY MBID, never by captured index.** The preview
   fetch resolves later; if you write back with `q.map((item,i)=> i===index ...)`
   using the index captured at request start, a listener who advanced meanwhile
   gets track A's preview/artwork attached to track B (wrong audio plays). Match
   `item.mbid === targetMbid` instead. Also de-dupe in-flight fetches with a
   `Set<string>` of MBIDs so re-runs don't stack duplicate requests.
4. **Hydrate link-outs for segued items when resolving preview.** Seed items
   carry `links`; segue items start `links: []`. When a segue item has no
   preview, the ride bar must still degrade to an external link, so fetch
   `getRecording(mbid)` alongside the preview and fill `links` if empty. Honors
   the Lore "attribute everything / UI degrades gracefully" constraint.

**Why:** these were the exact severe bugs an architect review caught in M2 —
whole-queue effect deps restarted clips, index-keyed writes mis-attached
previews. All four rules together keep continuous playback smooth and correctly
attributed.

**How to apply:** any change to `artifacts/lore/src/player/PlayerProvider.tsx`
playback/preview effects. Also relevant: the app is served under base path
`/lore/`, so e2e/browser tests must navigate to `/lore/song/<mbid>`, not `/song/...`
(root resolves to a different artifact and 404s). The detached `new Audio()`
element is not in the DOM, so browser test probes for an `<audio>` tag return
null — verify playback via the ride status/UI, not a DOM audio probe.
