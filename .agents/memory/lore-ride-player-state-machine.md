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

## Remote (Spotify Connect) playback rules
When the ride remote-controls the listener's own Spotify instead of the
`<audio>` element:
1. **The live player snapshot is the authority — never gate polling on a local
   paused flag.** If polling stops while "paused", a resume made directly in
   the Spotify app is never seen and the ride deadlocks.
2. **Flip the local paused flag only after the pause/resume API confirms**
   (rollback semantics), or a failed command desyncs local state from the
   device.
3. **End-of-track detection needs a grace window** (two consecutive
   "ended-looking" polls) — a single `!isPlaying` blip during Spotify's own
   transitions must not skip tracks. Distinguish: ours+playing → playing;
   ours+stopped+progress>0 (or we commanded pause) → paused; other track
   actively playing → listener took the wheel, ride yields (`ended`), never
   fight their device; else count toward ended.
4. **Per-track fallback, not mode-wide:** a track that fails on Spotify goes
   into a failed set and rides the preview ladder; later tracks retry Spotify.
   Refs don't re-render — bump a state tick so the mode recomputes.

**Why:** an architect review caught the pause-poll deadlock, optimistic pause
flag, and brittle end detection as ride-breaking bugs in the first Spotify
Connect implementation.
