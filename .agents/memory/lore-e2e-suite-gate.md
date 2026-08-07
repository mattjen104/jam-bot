---
name: Lore e2e suite gate
description: which lore browser specs gate merges and why the rest are excluded
---
`lore-e2e-suite` validation runs `artifacts/lore/e2e/run-e2e-suite-gate.sh` (fails loudly if Chromium or the lore dev server is missing, same pattern as the tone gate). It runs only the fully route-intercepted specs: importPickerEntryPoints and spotifyConnectCallback. interstitialTone stays in its own `tone-e2e` gate.

Excluded specs each carry a `// GATE-EXCLUDED:` header comment:
- fallbackNotice — discovers run IDs from LIVE spin data via pinned MBID/picker anchors that drifted out of the dev DB; live-data flaky. Stabilizing means route-intercepting the discovery endpoints.
- libraryPromptVisibility + spotifyConnectButton — target `library-prompt`, a banner removed when the connect surface moved into the Library page.
- librarySyncLifecycle — targets `library-sync`/`library-sync-receipt`/`library-sync-button` testids removed in the Library dial-style redesign (only `library-sync-receipt-toggle` survives).
- linerNotesSheet — tests RecordPeekNav, currently hidden (not rendered) in App.tsx.
- ntsOnAirBadge — clicks `station-<slug>` cards from StationList, which is no longer mounted anywhere (front door is the dial hero).

**How to apply:** when repairing/reviving one of these specs, add it back to the gate script's spec list and drop its GATE-EXCLUDED header. If UI it tests returns (e.g. RecordPeekNav un-hidden), the matching spec is the ready-made regression net.
