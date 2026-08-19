---
name: Radio duck/restore contract
description: Semantics for ducking the live stream during station-track scans and the pitfalls around volume state and mocks.
---

# Radio duck/restore contract

The station scan ducks the live stream (element volume → 0.15) instead of stopping it, so there is no reconnect cost.

Rules:
- `duck()` writes ONLY the audio element's volume; user-facing volume state is untouched. The saved restore target lives in a ref.
- `setVolume()` while ducked updates the saved restore target but must NOT raise the live element — any volume-sync effect keyed on state has to be duck-aware or a state update silently un-ducks.
- `restoreDuck()` is idempotent/no-op when not ducked. Every path that ends or takes over the scan must restore: stop, land, unmount, failed preview, and any ride/cast entry point that claims audio (there is more than one ride-start path — cover them all).
- Scan navigation while paused must be state-driven: resume re-runs playback for the CURRENT index; a hop must silence the outgoing preview immediately and invalidate in-flight lookups, or a stale source plays under the newly selected row.

**Why:** stopping the stream forces a full reconnect on landing; a state-keyed volume effect clobbered the ducked element mid-scan; paused-hop-resume replayed the stale preview (both caught by tests/review).

**How to apply:** new audio-claiming code paths call `restoreDuck()` first. Hand-written test fakes of the radio hook break at runtime (not typecheck) when the hook API grows — extend every fake when adding methods.
