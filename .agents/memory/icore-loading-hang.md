---
name: isCoreLoading live-gate hang
description: Why gating the radio dial spinner on liveLoading causes an infinite hang, and the correct split-gate pattern.
---

## The rule

`isCoreLoading` in `useDialData` must equal `stationsLoading` only — never `stationsLoading || liveLoading`.

**Why:** For unauthenticated users (no library), `sortedRows` (live zones) is empty until `liveData` arrives. If the offline section is also gated on `!liveLoading`, the entire content area is blank while the live pulse is in flight. If the live pulse is slow (e.g. during a burst of import workers saturating the server), the user sees a blank page indefinitely.

**How to apply:**

- Spinner guard: `{isCoreLoading && <div className="dial-loading">…</div>}` — uses only `stationsLoading`.
- Offline section: no `!liveLoading` gate — show as soon as `!isCoreLoading`. Accept the brief re-sort (200–500ms flash) when live data arrives; it is less disruptive than a blank page.
- `useDialData` returns both `isCoreLoading` and `liveLoading` so callers can apply the correct guard level per section.

## Context

The original complaint was a flash: offline stations briefly appeared before live zones loaded. The "fix" was to hide everything until both data sources arrived. This caused the hang. The correct trade-off is: accept the cosmetic flash, prevent the functional hang.

A secondary contributing factor: import workers running concurrently (resumed on restart via `prevWithBuffer` from an errored job) saturated the server, slowing `/api/stations/now-playing` responses to 10–30s. Even a well-designed gate would have appeared hung during that burst.
