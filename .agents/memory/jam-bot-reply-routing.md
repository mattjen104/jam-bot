---
name: jam-bot reply routing & ambient card gating
description: Why jam-bot uses origin-based routing + Jam-gated ambient cards instead of a quiet-mode toggle, and why the JAM_QUIET_DM_USER env name was kept.
---

# Jam-bot: origin-based routing + Jam-gated ambient cards

The bot replies **wherever it was addressed** (DM→DM, channel→channel). There is
no quiet/test-mode toggle anymore — `/quiet` + `silentMode` were retired.

**Rules:**
- Ambient (non-tour) now-playing cards post to the channel ONLY when the host
  Spotify account is in an active Jam (`isJamActive()` in `spotify/jam.ts`).
- A guided tour follows its origin: a DM-started tour narrates entirely in the
  DM (card + tidbit DM'd to host); a channel tour stays in the channel. The
  tour's `origin` is captured at consume time so the last track still routes
  correctly even though the tour clears itself on its last track.

**Why:** the old model leaked DM-started tours to the channel, and ambient
cards spammed the channel even when nobody was listening together. Gating on an
active Jam means "no Jam = silence" by default, removing the need for a manual
mode.

**`isJamActive()` MUST fail SAFE:** any relay/network/auth error (including the
relay being unconfigured) resolves to `false` (suppress cards), never throws.
Result is cached for `JAM_ACTIVE_CACHE_MS` (default 15s) so the per-track
now-playing hot path never hammers the relay.

**`JAM_QUIET_DM_USER` name was intentionally NOT renamed** — it now means "the
host allowed to DM the bot" (DM-auth identity). Kept the old name to avoid
churning the droplet's hand-maintained `.env`. Don't "fix" this name.
