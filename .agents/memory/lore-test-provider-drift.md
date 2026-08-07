---
name: Lore test provider drift
description: How stale lore UI tests break when components gain react-query hooks, and the house fixes.
---

Rule: whenever a lore component gains a react-query hook (useAppConfig, useMyAlbumAvatar, generated useGetStationNowPlaying...), every test rendering it without a provider throws "No QueryClient set" — the house fix is a barrel mock (`makeMeHooksMock` for src/lib/meHooks, or adding the hook to the `@workspace/api-client-react` module mock), NOT wrapping in QueryClientProvider.

**Why:** 180 tests across 19 files went red at once from a few hook additions plus the DialTimeTravelStrip removal (strip stays exported for unit tests; the live UI is hero-art chevrons + topbar moon). Red noise hid a real bug: the Tier-1 bulk `spotifyQueueRun` effect wasn't gated on `interstitialArmed` and could start playback before the crossing confirmation.

**How to apply:** after adding any hook to a shared component (PlayerProvider, LibraryRow, DialView), run the full lore vitest suite; fix breaks with the barrel-mock pattern; tighten `getByRole("button")` queries to accessible names since rows keep gaining buttons (e.g. album-avatar ◎).
