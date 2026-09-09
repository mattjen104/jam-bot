---
name: Focused Lore demo boundary
description: Product boundary for the opt-in Radio and Library demonstration surface.
---

The focused demo is a server-controlled, opt-in mode that exposes one dependable listener loop: Radio → Keep → Library → supported music detail → Radio. It must default off, keep admin routes reachable, and leave the full Lore interface unchanged when disabled. The existing Songs/Artists Library remains authoritative; never build a parallel demo Library.

**Why:** The demo is meant to prove the core radio-to-library value without exposing unfinished listener destinations or coupling a Keep action to Spotify setup. Replacing shared models for the demo caused immediate drift from already-approved Library behavior.

**How to apply:** Put new demo-only surfaces and navigation behind the server flag. Keep detail routes needed by Library functional, redirect unfinished listener routes to Radio, and make Keep use the device-local Lore path without launching Spotify connection. Add richer context in isolated demo components rather than progressively hiding controls in legacy surfaces.