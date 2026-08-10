---
name: FirstRunSidebar provenance rung design
description: Rules for the first-run onboarding sidebar: rung classification, artist resolution, interaction model, and test gotchas.
---

## Rung classification (`deriveRung`)

Order matters — check automation FIRST, then show flags:

1. `automationClass === "automated"` → **rung 4** (absolute precedence, overrides any show/DJ data)
2. `liveShow?.isPickerShow === true` → **rung 1** (validated single selector; `djName` alone is NOT sufficient)
3. `liveShow` present (any other) → **rung 2** (live shift, host not validated as picker)
4. No live show → **rung 3** (attributed station, no agent claim)

**Why:** `isPickerShow` is set by `useDialData` only when a picker ID and exactly one eligible DJ are present. A named but unvalidated show must not become the strong "X is playing…" claim.

## Artist resolution

Use `spin.artistMbid` (not `spin.mbid` / recording MBID) for the resolved/unresolved decision.

- `artistMbid !== null` → resolved, interactive keep (role=button, tabIndex=0, aria-pressed)
- `artistMbid === null` → unresolved, **plain `<span>`** — no role, no tabIndex, no aria handlers

**Why:** Recording and artist resolution are independent. A recording may resolve while the artist identity is still unknown in the graph, and vice versa. Keyboard-focusable buttons that do nothing are an accessibility failure.

## Test gotchas

- When a fixture derives one flag from another (e.g. picker-show from djName), override explicitly to test the divergent case — otherwise the test reproduces the production bug instead of catching it.
- Scope DOM queries to `container` from `render()`, never `document.querySelector` — stale nodes from prior renders accumulate without confirmed cleanup.
