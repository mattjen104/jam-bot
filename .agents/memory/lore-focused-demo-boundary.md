---
name: Focused Lore demo boundary
description: Product boundary for the opt-in Radio and Library demonstration surface.
---

The focused demo is a server-controlled, opt-in mode with one Library surface. Library opens on Stations and uses underlined Stations, Songs, and Artists text controls to switch views. The station label includes the total station count. It must default off, keep admin routes reachable, and leave the full Lore interface unchanged when disabled. The existing Songs/Artists Library remains authoritative; never build a parallel demo Library or separate Radio/Library navigation.

**Why:** Stations and kept music are one collection in the focused product model. Combining them removes redundant Radio/Library navigation while preserving the approved Library behavior and the direct Keep path.

**How to apply:** Put demo-only composition behind the server flag. Redirect the demo root and unfinished listener routes to Library, default its view to Stations, keep supported detail routes functional, and make Keep use the device-local Lore path without launching Spotify connection. Do not restore fixed bottom navigation.