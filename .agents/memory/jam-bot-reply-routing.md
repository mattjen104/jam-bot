---
name: jam-bot reply routing, ambient card gating & quiet mode
description: How jam-bot routes replies (origin-based), gates ambient cards on an active Jam, and the JAM_QUIET_MODE escape hatch for relay-less private testing.
---

# Jam-bot: origin-based routing + Jam-gated ambient cards + quiet mode

The bot replies **wherever it was addressed** (DM→DM, channel→channel).

**Rules:**
- Ambient (non-tour) now-playing cards post to the channel ONLY when the host
  Spotify account is in an active Jam (`isJamActive()` in `spotify/jam.ts`).
- A guided tour follows its origin: a DM-started tour narrates entirely in the
  DM (card + tidbit DM'd to host); a channel tour stays in the channel. The
  tour's `origin` is captured at consume time so the last track still routes
  correctly even though the tour clears itself on its last track.

**Why:** the old `/quiet` + `silentMode` toggle leaked DM-started tours to the
channel, and ambient cards spammed the channel even when nobody was listening
together. Gating on an active Jam means "no Jam = silence" by default.

**`isJamActive()` MUST fail SAFE:** any relay/network/auth error (including the
relay being unconfigured) resolves to `false` (suppress cards), never throws.
Cached for `JAM_ACTIVE_CACHE_MS` (default 15s) so the now-playing hot path never
hammers the relay.

**`JAM_QUIET_DM_USER` name was intentionally NOT renamed** — it means "the host
allowed to DM the bot" (DM-auth identity). Kept to avoid churning the droplet's
hand-maintained `.env`. Don't "fix" this name.

## Quiet mode (`JAM_QUIET_MODE`)
A deliberate escape hatch reintroduced after the relay became unrunnable: with
no relay, `isJamActive()` can never be true, so ambient cards stay suppressed
forever. `JAM_QUIET_MODE=true` (no-op unless `JAM_QUIET_DM_USER` is also set)
makes the **ambient** now-playing path route the full deep-knowledge card — its
async enrichment tabs and live insights too — to the host's DM and **bypass the
relay Jam gate** entirely.

**How to apply:** single source of truth is `quietDmTarget()` in `bot.ts`
(returns the DM user id when both env vars are set, else null). It gates two
spots: the ambient `trackChange` handler (skips `isJamActive()`, sets
`serveTrackCard` dest to the DM) and `deliverCard` (DM branch before the
`isJamActive()` channel branch; turntable-DM precedence stays first).
`enrichCard` tab updates already follow `state.channel`, so the DM card updates
in place with no extra change. Skip-votes auto-disable in a DM
(`serveTrackCard`: `wantsVote = vote && dest.kind === "channel"`). Default off,
so the normal channel path is unchanged.

## On-demand deep card (`/nowplaying`)
The ambient deep card only fires on a track CHANGE the polling watcher catches —
flaky to trigger and impossible to verify on a remote droplet. So `/nowplaying`
(and the "what's playing" NL intent) renders the **same full deep card** on
demand via `serveTrackCard`, routed to the host DM whenever quiet mode is active,
else to the request origin. Use `vote:false` for these — an info pull must not
create an `activeVote` that clobbers the real ambient card's skip-vote.

**Invariant — deep cards never thread:** `serveTrackCard` always posts a
top-level message (channel = `SLACK_CHANNEL_ID` or the DM user id); it has no
`thread_ts` path. So an in-thread NL request gets its deep card at channel
top-level, consistent with how ambient cards already post. Don't add threading
to deep cards without also moving the card-state/vote keys (`cardKey`) — they're
keyed on channel+ts and assume one canonical surface.

**Why:** operator (the host) lost the home relay, so the ambient path can never
self-trigger for them; an on-demand pull into the DM is the only reliable way to
see/verify the deep card. **Startup log** prints quiet-mode status (`ACTIVE → DM
<id>` vs `OFF`) so the operator can confirm both env vars loaded after a
`systemctl restart` without reading code.
