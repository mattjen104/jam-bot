---
name: Focused Lore demo boundary
description: Product boundary for the opt-in Radio and Library demonstration surface.
---

The focused demo is a server-controlled, opt-in mode with one Library surface. Library opens on Stations and uses underlined Stations, Songs, and Artists text controls to switch views. The station label includes the total station count. It must default off, keep admin routes reachable, and leave the full Lore interface unchanged when disabled. The existing Songs/Artists Library remains authoritative; never build a parallel demo Library or separate Radio/Library navigation.

Stations does not include a “Kept today” strip. Songs is the single chronological history of everything kept, so repeating a subset on Stations creates redundant navigation and data fetching.

Artist management is contextual on Stations: show a prominent “Add artists” action only at zero artists; after onboarding, replace it with a compact “Edit” action beside the artist count. Keep Songs and Artists counts in the shared view controls.

**Why:** Stations and kept music are one collection in the focused product model. Combining them removes redundant Radio/Library navigation while preserving the approved Library behavior and the direct Keep path.

**How to apply:** Put demo-only composition behind the server flag. Redirect the demo root and unfinished listener routes to Library, default its view to Stations, keep supported detail routes functional, and make Keep use the device-local Lore path without launching Spotify connection. Do not restore fixed bottom navigation.