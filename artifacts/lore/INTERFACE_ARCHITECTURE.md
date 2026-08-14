# Lore Unified Minimal Interface Architecture

**Version:** 1.0 — August 2026  
**Status:** Spec / design spike. Implementation follows in subsequent tasks.  
**Scope:** Routes, nav, row format, sheets, metadata layer, CLI boundary, breakpoints, open questions.  
**Out of scope:** Admin pages (separate audience), the standalone `/player` surface (kept separate by design).

---

## 1. The Three-Phase Loop

Everything in Lore organises around a single loop:

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   SEED artists you care about                                   │
│          │                                                      │
│          ▼                                                      │
│   SCAN ─── live Feed ──► crossing rows show seeded artist       │
│   (Phase 1)               on air anywhere on the network        │
│          │                                                      │
│          ▼ (tap Keep on expanded row)                           │
│   KEEP ─── provenance captured: station · show · time · DJ     │
│   (Phase 2)  no navigation. no friction.                        │
│          │                                                      │
│          ▼                                                      │
│   STACK ─── kept recordings accumulate into an album-first      │
│   (Phase 3)  backlog. Launch when ready. Investigate albums     │
│              you want to know more about.                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

The current nav (`[lore]` / `[my library]`) is organised around entity types — stations, DJs, artists, archive, selectors. The new model organises around **workflow phases**. Every feature maps to one of these three phases.

---

## 2. Navigation Shape

Two labels. No secondary tabs.

| Label    | What it is                                                            |
|----------|-----------------------------------------------------------------------|
| **Feed** | The live Dial. Crossing rows, ghost rows, player dock.               |
| **Stack**| The kept-album backlog. Album rows expandable to kept tracks.        |

Artist seeding lives at the top of the crossing section in the Feed — a quiet `+` affordance that opens an inline search input. First-run sidebar stays identical. No navigation away from the Feed during seeding.

### Breakpoint behaviour

| Viewport                   | Nav placement            | Sheet behaviour                   |
|----------------------------|--------------------------|-----------------------------------|
| Portrait phone             | Bottom (two labels)      | Slides up from the bottom         |
| Landscape phone / tablet   | Left edge (two labels)   | Slides in from the right          |
| Desktop                    | Two corner links         | Persistent right panel when open  |

Player dock sits above bottom nav on portrait phone; pinned to the bottom of the Feed on wider viewports.

---

## 3. Row Format and the Principle of Parallel Formatting

The Feed and Stack use **identical row grammar** so that a row "in the Feed" and the same item "in the Stack" feel like two views of the same object, not two different UIs.

### Why the current pipe layout fails

The current Dial row is a three-column CSS grid:

```
[artist ────────→] | [←── station]
```

`minmax(0,1fr) auto minmax(0,1fr)` with artist right-aligned and station left-aligned. Problems:

- Artist — the thing you seeded — terminates at the pipe, forcing the eye to the centre first.
- Whitespace distribution is uneven when names are short or long.
- Wrapping is counter-natural (right-to-left) in a monospace/terminal context.

### The principle

A row reads like a sentence: **most important entity first**, dot separator, secondary entity. Metadata right-aligned. No centering.

```
primary  ·  secondary                          [right metadata]
byline line (smaller, system-sans)             [right action]
```

---

### 3a. Feed rows (Phase 1 — Scan)

**Collapsed — live crossing:**
```
[artist name]  ·  [station name]
```
- Artist: full weight, the lead (it is the thing you seeded)
- Separator: `·` centred dot — lower visual weight than a pipe
- Station: secondary weight (muted colour, same line)
- Monospace/terminal font throughout
- No artwork in the collapsed row — text-first surface

**Expanded — live crossing:**
```
[artist name]  ·  [station name]
[show / DJ name]  ·  [now-playing title]      [+ Keep]
```
- Byline line: system-sans interface weight, smaller size
- Keep affordance is on the byline, not the collapsed row — avoids accidental keeps, keeps the feed scannable
- `+` seed affordance for non-library artists also on the byline
- **First tap expands; second tap (or long-press on collapsed) tunes.** Chosen to reduce accidental tune-ins. Preserves the scan loop without jumping away.

**Crossing row with metadata coverage marker:**
```
[artist name]✳  ·  [station name]
[show / DJ name]  ·  [now-playing title]      [+ Keep]
```
- `✳` superscript appears only when Lore has catalogued metadata for this artist (reviews, episodes, production articles, etc.)
- On hover/focus: tooltip "Album investigation sources available"
- Tapping `✳` opens the Artist sheet, which shows the coverage summary
- No metadata content is displayed inline on the Feed — the marker is diagnostic only, for coverage auditing

**Ghost row — "missed while away":**
```
[artist name]  ·  [station name]              [time ago]
[show name — if known]                        [→ replay]
```
- Same anatomy as live rows
- Visually desaturated vs live rows (reduced opacity)
- Replay affordance on the byline
- Replaces `/archive` for casual discovery use

---

### 3b. Stack rows (Phase 3 — Launch)

Stack is a **flat scrolling list** — no cards, no accordion rows, no column grids.
Every album is one line, exactly like a Feed crossing row but with album-first priority.

**Standard row:**
```
[album title]  ·  [artist name]  ·  [station kept from]          [N kept]
```
- Album title: full weight, the lead — it is what you will listen to
- Artist: secondary weight (muted colour, same dot separator as Feed)
- Station: tertiary — where you kept it from; omitted when ambiguous (multiple stations)
- Right edge: keep count (number of tracks kept from this album)
- Monospace/terminal font throughout — identical to Feed rows
- No artwork in the default row — text-first surface, same principle as Feed
- Coverage marker (`✳`) appears after the album title when investigation sources exist

**Row interaction — clicking the row launches the album:**
Clicking (or tapping) any Stack row starts the **universal player / export flow** for that album,
exactly the same mechanism used for ghost-set replay:

1. Lore resolves the album via the listener's preferred service (Spotify, Apple Music, YouTube Music, etc.) using the same multi-driver resolution chain.
2. Playback begins if a match is found. The player dock reflects the album.
3. The export affordance (`↗ export`) is available from the player dock — M3U8, JSON, Spotify URI list, etc.
4. If no service match is found, the flow surfaces the investigation sheet instead (gives you something useful rather than a dead end).

This makes kept albums immediately actionable: scan the Stack, spot an album, tap it, hear it — the same one-gesture model as tuning a station from the Feed.

**Secondary actions (accessible without navigating away):**
- Long-press / right-click the row → context menu: `Investigate ↗` / `Copy link` / `Remove from Stack`
- `✳` marker (when present) → opens the Album Investigation sheet directly
- Station name (when shown) → opens the Station sheet (same as tapping a station name in the Feed)

**No expansion by default.** The kept tracks and provenance are accessible via the investigation sheet, not an in-list expand. This preserves the scannable flat-list character of the Stack. If a listener wants to know *which specific tracks* they kept and from which show, they open the investigation sheet.

---

## 4. Album Investigation Layer (the metadata surface)

Scraped metadata — reviews, Song Exploder episodes, Beato interviews, Sound on Sound production articles, Pitchfork, AllMusic, Wikipedia critical summaries, and similar sources — is **only exposed when you are already investigating an album you have kept.**

Rationale: surfacing metadata on the live Feed would flood an already dense surface with content about music you may not keep. The value of this metadata is highest when you are deciding what to spend an hour listening to, not while you are scanning for crossings.

### Album Investigation sheet

Opened from:
- The `✳` marker on any Stack row
- The `Investigate ↗` option in the Stack row context menu (long-press / right-click)
- The Song sheet (for the album containing a kept track)
- The Artist sheet (list of albums with kept tracks, each with an investigate affordance)
- Automatically, when a Stack row tap fails to resolve the album on any service

The sheet shows **all kept tracks** for the album (title · station · DJ · date) at the top as provenance context, followed by the source cards. The `▶ launch` button is also present — if you investigated first and then decided to listen, you can launch from here without going back to the list.

Layout:

```
┌─────────────────────────────────────────────────────────────────┐
│  ← [album title]  ·  [artist]                   [▶ launch]      │
├─────────────────────────────────────────────────────────────────┤
│  [provenance block: N tracks kept · most recent: station · date] │
├─────────────────────────────────────────────────────────────────┤
│  SOURCES  ────────────────────────────────────────────────────  │
│                                                                 │
│  ● Song Exploder Ep. 245 — "The Making of [Track]"             │
│    [producer] talks through the drum arrangement ↗             │
│                                                                 │
│  ● Sound on Sound · Production profile · March 2019            │
│    "How [album] was recorded in Studio X" ↗                    │
│                                                                 │
│  ● Beato — What Makes This Song Great? · "Track name"          │
│    [14 min] ↗                                                   │
│                                                                 │
│  ● Pitchfork Best New Music (score: 9.2)                       │
│    "[Excerpt from review text, two sentences max]" ↗           │
│                                                                 │
│  ● AllMusic · 4.5★ · [Excerpt] ↗                               │
│                                                                 │
│  ── Not yet indexed ─────────────────────────────────────────   │
│  Wikipedia · RYM critical summary                              │
│  (will appear when Lore indexes them)                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### Source card anatomy

Each source is a single linked card:

```
[source label]  ·  [content type]          [date / score / duration]
[two-sentence excerpt or descriptive subtitle]                [↗]
```

- Source label: Song Exploder, Sound on Sound, Beato, Pitchfork, AllMusic, Wikipedia, RYM, etc.
- Content type: Production profile / Interview / Review / Video essay / Rating
- Excerpt: two sentences max; `[Not yet indexed]` when Lore has no copy
- `↗` opens the external link
- `Not yet indexed` sources are listed in a separate section so you can see what coverage exists vs what is missing — the empty state is honest, not hidden

#### Coverage marker and audit path

When any investigation sources exist for an artist or album, a `✳` appears:
- On the artist name in an expanded Feed row (audit only, no inline content)
- On the album title in the Stack (collapsed and expanded)

Tapping `✳` on the Feed goes to the Artist sheet → `[N albums with sources]` → Album Investigation sheet.  
Tapping `✳` on the Stack goes directly to the Album Investigation sheet.

This lets you audit metadata coverage across the network without polluting the live surface.

---

## 5. Sheet Hierarchy

All entity detail views become sheets that slide over the Feed or Stack without a full route change. Two levels deep maximum. Closing returns to exact scroll position.

| Sheet           | Opened from                              | Contents                                                         |
|-----------------|------------------------------------------|------------------------------------------------------------------|
| Station sheet   | Any station name in a Feed or Stack row  | Current show block, recent sets, tune button                     |
| Show sheet      | Station sheet or ghost row               | Set list, crossing moments highlighted, DJ/selector attribution  |
| Artist sheet    | Any artist name in Feed or Stack         | Stations that have aired them, keep count, service link, coverage summary |
| Song sheet      | Any keep or tracklist sub-row            | Provenance (station / show / time / DJ), service links, Keep toggle |
| Album Investigation sheet | Stack expanded row `[↗ investigate]` or `✳` marker | Source cards, provenance block, launch button |

### Full-page routes that survive (share links only)

Internal navigation always opens the sheet. These routes exist so external share links land somewhere:

- `/song/:mbid`
- `/album/:mbid`
- `/artist/:mbid`
- `/replay/:id`

---

## 6. Route Survival Table

| Current route                     | Fate                                       | New home                                              |
|-----------------------------------|--------------------------------------------|-------------------------------------------------------|
| `/` (Home / Dial)                 | **Survives** — becomes Feed                | Feed, renamed                                         |
| `/library`                        | **Survives** — becomes Stack               | Stack, renamed                                        |
| `/song/:mbid`                     | **Survives** (share link)                  | Song sheet internally; page for share links           |
| `/album/:mbid`                    | **Survives** (share link)                  | Album Investigation sheet internally                  |
| `/artist/:mbid`                   | **Survives** (share link)                  | Artist sheet internally                               |
| `/replay/:id`                     | **Survives** (share link)                  | Song sheet replay mode                                |
| `/journal`                        | Collapses                                  | Stack filter via hidden gesture (like Sleep Radio)    |
| `/archive`                        | Collapses                                  | Ghost row section + Station sheet                     |
| `/archive/stations/:slug`         | Collapses                                  | Station sheet (internal nav)                          |
| `/archive/station-runs/:runId`    | Collapses                                  | Show sheet (internal nav)                             |
| `/stations`                       | Collapses                                  | Station sheet                                         |
| `/schedule`                       | Collapses                                  | Station sheet ("next show: …")                        |
| `/selectors`                      | Collapses                                  | Show sheet (DJ/selector attribution row)              |
| `/selectors/:id`                  | Collapses                                  | Show sheet                                            |
| `/dj/:name`                       | Collapses                                  | Show sheet                                            |
| `/following`                      | Collapses                                  | Stack sub-view, no nav slot                           |
| `/sets`                           | Collapses                                  | Stack sub-view (imported sets), no nav slot           |
| `/weekly-recap`                   | Collapses                                  | Stack sub-view, no nav slot                           |
| `/taste-map`                      | **Removed** (already redirects home)       | —                                                     |

---

## 7. Feature Mapping Table

Every current Lore capability maps to a location in the new model.

| Current capability                            | New location                                              |
|-----------------------------------------------|-----------------------------------------------------------|
| Live Dial — crossing rows                     | Feed — crossing rows (lead: artist, secondary: station)   |
| Ghost rows ("missed while away")              | Feed — ghost section, same row grammar, desaturated       |
| Artist seeding (+ affordance)                 | Feed — inline `+` at top of crossing section              |
| First-run sidebar                             | Feed — unchanged                                          |
| Player dock (tune / keep)                     | Feed — docked above bottom nav; Keep on expanded row only |
| Keep action                                   | Feed — expanded row byline; also Song sheet               |
| Library / kept tracks                         | Stack — provenance detail in the Album Investigation sheet|
| Album backlog                                 | Stack — flat scrolling list, album-first single-line rows |
| Album playback                                | Stack row tap → universal player / export flow (same as ghost-set replay) |
| Journal (timestamped keeps)                   | Stack — hidden gesture filter (same pattern as Sleep)     |
| Weekly recap                                  | Stack — sub-view, no nav slot                             |
| Following (stations/DJs)                      | Stack — sub-view, no nav slot                             |
| Imported sets (XSPF/JSPF)                     | Stack — sub-view, no nav slot                             |
| Station detail                                | Station sheet (from any station name)                     |
| Show / run detail                             | Show sheet (from Station sheet or ghost row)              |
| DJ / selector detail                          | Show sheet (DJ/selector attribution row)                  |
| Schedule                                      | Station sheet ("next show: …")                            |
| Archive                                       | Ghost rows + Station sheet                                |
| Scraped metadata (reviews, podcasts, articles)| Album Investigation sheet (Stack only)                    |
| Coverage marker (audit)                       | `✳` on artist/album when metadata exists                  |
| Share links (song/album/artist/replay)        | Full-page routes survive for external links               |
| Taste-map                                     | Removed (already a redirect)                              |
| Spotify library import                        | CLI / import job                                          |
| Archive exports (M3U8, JSON, CSV)             | CLI                                                       |
| Admin / poller management                     | Admin pages (separate audience, out of scope)             |

---

## 8. CLI Boundary

The UI covers the **real-time three-phase loop** only. The CLI covers:

| CLI domain                    | Examples                                             |
|-------------------------------|------------------------------------------------------|
| Bulk imports                  | Spotify library, CSV                                 |
| Archive exports               | M3U8, JSON, CSV                                      |
| Taste-seed management         | add / remove / list in bulk                          |
| Admin / debug                 | Poller management, DB queries, coverage audit by MBID|

This boundary is documented here so it is not re-litigated for each new feature. If a capability requires batch processing, admin privilege, or a non-interactive pipeline, it belongs in the CLI.

---

## 9. Open Questions

These are named explicitly for follow-up decision. Each requires a product decision, not a code decision.

### 9a. Expand-then-tune vs tap-to-tune

**Expand-then-tune (chosen default above):** First tap on a collapsed Feed row expands it — byline and Keep appear. Second tap (or long-press on the collapsed row) tunes in.

**Tap-to-tune (alternative):** First tap tunes immediately (current behaviour). Expansion is a swipe-right or secondary affordance.

_Tradeoff:_ Expand-then-tune is more deliberate and reduces accidental tunes, but adds friction for returning users who know what they want. Tap-to-tune preserves current muscle memory but hides Keep behind a gesture.

_Recommendation to revisit after first implementation sprint._

### 9b. Art in the Stack

The minimal default is text-only album rows — one line per album, no cover art. Options if art is ever introduced:

1. **Lens toggle** — a control at the top of the Stack switches between the default text list and a 3-column cover-art card grid.
2. **Art in the investigation sheet only** — cover art appears in the Album Investigation sheet, not in the scrolling list at all.
3. **Art always in the list** — a small thumbnail left of the row text (breaks the "text-first" / parallel-with-Feed principle; not recommended as the default).

Note: the flat-list, text-first default is locked in by the parallel-with-Feed principle. Art options are lenses on top of that default, not replacements for it.

### 9c. Selectors / pickers placement

Currently: selectors get their own route. Options in the new model:

1. **Show sheet only** — selectors surface via DJ/selector attribution in the Show sheet. Stack has no "From selectors" lens.
2. **Stack lens** — a "Curated" lens in the Stack shows keeps that arrived via a named selector, separately from the default album view.

_Option 1 is simpler. Option 2 makes curated keeps a first-class artifact._

### 9d. Stack sort options

Default: album-first, sorted by most-recently-kept track. Named alternative: "by station" — "what has WFMU played that I've kept?" This is a useful query for listeners who follow a station as a taste authority, not just as a discovery mechanism.

### 9e. Ghost row prominence

"Missed while away" currently trails the live feed. Under this model, ghost rows replace `/archive` for casual discovery. Options:

1. **Status quo** — ghost rows trail live rows in one flat feed.
2. **Time-gated section header** — a "Last 48 hours" section divides the feed when ghost rows exist, giving them a named context.
3. **Ghost-first when no live crossings** — when the user has no live crossings, the feed leads with the ghost section rather than showing an empty state.

### 9f. Investigation source coverage audit tool

The `✳` marker enables ad-hoc auditing of metadata coverage. A more systematic audit path could be:

1. **In-app only** — tap `✳` on any artist/album to see source coverage.
2. **Admin report** — a table in the admin panel showing MBIDs with / without investigation sources, source type breakdown.
3. **CLI command** — `lore coverage --artist <mbid>` or `lore coverage --album <mbid>` returns source list.

Options 2 and 3 are more efficient for bulk coverage review. Option 1 is sufficient for initial testing.

---

## 10. What a New Contributor Needs to Know

1. **The mental model:** Radio → Keep → Albums. Everything maps to one of these three phases.
2. **Two nav labels:** Feed (Phase 1 + 2) and Stack (Phase 3). No secondary tabs.
3. **One row grammar:** `primary · secondary · tertiary  [right metadata]` — monospace, left-to-right, no centering. Feed rows lead with artist; Stack rows lead with album. Same grammar, different priority order.
4. **Stack is a flat scrolling list:** No accordion cards, no column grids. One line per album, identical in structure to a Feed crossing row. Tapping a Stack row launches the album in the universal player, same mechanism as ghost-set replay.
5. **Sheets, not routes:** All drill-downs are sheets. Full-page routes exist only for external share links.
6. **Metadata is in the Stack:** Scraped sources (reviews, podcasts, production articles) live in the Album Investigation sheet, not in the scrolling list. The `✳` marker on a Stack row signals that sources exist.
7. **CLI for bulk work:** Imports, exports, and admin belong in the CLI, not the UI.
8. **Player dock is always visible:** Tuning or launching never requires leaving the current view.

---

*Document produced as part of Task 89 — Lore unified minimal interface architecture.*  
*Implementation begins in the follow-up task set.*
