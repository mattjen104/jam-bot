---
name: Focused Lore demo boundary
description: Product boundary for the opt-in Radio and Library demonstration surface.
---

The focused demo is a server-controlled, opt-in mode with one Library surface. Library opens on Stations and uses underlined Stations and Songs controls to switch views. The station label includes the total station count. It must default off, keep admin routes reachable, and leave the full Lore interface unchanged when disabled. Never build a parallel demo Library or separate Radio/Library navigation.

Stations does not include a “Kept today” strip. Songs is the single chronological history of everything kept, so repeating a subset on Stations creates redundant navigation and data fetching.

Artist focus and explicit taste management share one searchable artist lens in the Library header, but the control must make those states distinct. Adding or removing an explicit artist changes taste seeds only; removing one must never delete kept songs.

Stations and Songs are the only primary views. A URL-backed artist focus persists across both and filters both. Stations has one contextual sort. Songs supports Recently kept, Artist, Album, Title, and Most kept; Artist and Most kept show grouped songs, while Album stays an organization mode rather than a primary section.

Focused artist album mode separates saved-from-radio albums from other albums. “Saved” means at least one kept track, not a fully saved album. Other albums must come only from existing catalogue or artist-release data; when unavailable, show an honest unavailable state.

**Why:** An Artists primary view duplicated Songs organized by artist. One artist lens plus contextual organization keeps the interface compact without hiding taste management or inventing discography data.

**How to apply:** Keep focus, sort, and selected album state in the demo Library URL. Artist links focus the artist and open album organization; album links preserve the artist and selected album. Full Lore links and behavior remain unchanged when demo mode is off.

**Why:** Stations and kept music are one collection in the focused product model. Combining them removes redundant Radio/Library navigation while preserving the approved Library behavior and the direct Keep path.

**How to apply:** Put demo-only composition behind the server flag. Redirect the demo root and unfinished listener routes to Library, default its view to Stations, keep supported detail routes functional, and make Keep use the device-local Lore path without launching Spotify connection. Do not restore fixed bottom navigation.