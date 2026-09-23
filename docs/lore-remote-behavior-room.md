# Lore Remote — behavior and room rules (proposal)

Companion to `attached_assets/lore-remote-spec_1790205245025.md`. This document refines behavior; it does **not** authorize replacing Lore's navigation, opening public chat, or changing the data model. Recommendations below are defaults for a prototype and an opt-in first release, not claims that these features already exist.

## Product boundary

- Build the remote *inside Lore*, initially as an isolated prototype and then, if approved, behind an opt-in route. Existing Radio, Library, Inbox, Rotation, Shelf, and Slack Jam Bot remain available during rollout.
- Dig, Listen, and Ambient are **views of one listener's state**, not three separate libraries. Intent switching changes what is visible, never starts, stops, pauses, or retunes audio. Only an explicit Tune or Play action changes playback.
- The Shelf drawer is a way into the existing Library, not a second collection. A kept **recording** belongs to the listener's Library; an **album** enters the Library as a whole only when explicitly filed to Shelf. An album in Inbox or Rotation is still under evaluation. Passing an album does not unsave its individual kept track.
- Use the current `lore_users` device-bound listener for personal workflow state and current `album_workflow` release-group state for Inbox/Rotation/Shelf/Passed. The proposed `user_settings`, `inbox_item`, `rotation_item`, and `shelf_item` names are conceptual, not existing tables. Add fields/events only for behavior we actually ship; do not duplicate album-state records.

## Shared interaction rules

| Action | Result | Does **not** do |
| --- | --- | --- |
| Switch intent | Persist the selected view for this listener; keep the same audio and selected station. | Start an Ambient stream, stop radio, or count a play. |
| Tune a station preset | Explicitly hand playback to that station; display loading, playing, and failure. | Claim a new song started until fresh station evidence confirms it. |
| Play an album | Ask the existing provider/preview path for an explicitly chosen album or track. | Promise full-album playback when only a 30-second preview exists. |
| Keep a live spin | Use existing confirmed/pending Keep behavior. Save the track once, retain real spin/station provenance when available, then offer grounded album candidates. | Invent a recording MBID, silently file a whole album, or duplicate a Keep. |
| Move an album | Change its one workflow state; show the updated rail and Library count together. | Change ownership of separately kept recordings or automatically play it. |

Every mutation must be idempotent for a repeated tap and resolve against the current server state; a stale device view must not overwrite a later decision without showing the new state. Labels and counts must distinguish confirmed identity, unresolved identity, and source outages.

## Dig

- The five-station bank is a set of *presets*, not the ranked five-station dial itself. Initial suggestions may come from today's front-door ranking, but adding/reordering a preset is a listener choice. Never replace a saved preset silently when rankings change.
- SCAN reuses the existing user-initiated radio-scan path. It may prefer a likely track boundary, but metadata timing is uncertain: show a preview/landing state and wait for a fresh post-landing observation before saying the new song is confirmed. Stopping a scan does not auto-Keep.
- The five-segment library meter is a visual scale, **not five invented levels of similarity**. Version one can show three labeled outcomes: exact recording kept; confirmed artist in the listener's library; no confirmed match. Unknown identity stays “Unknown,” not “none.” Similarity/adjacency is deferred and must be visibly inferred if later introduced.
- Inbox tiles show the kept recording and the real station when known, linked to an album candidate if one is resolved. A Keep with no trustworthy album stays a kept track/unresolved candidate, not a fabricated album tile. Multiple Keeps for one release group can converge on one album workflow item while retaining each original track's provenance.
- Rotate promotes the album into one of **four** slots. The capacity check and move must be atomic on the server; two devices cannot both take the fourth slot. A duplicate Rotate on an already-rotating album is a no-op. When full, explain which album must be moved first; never auto-evict. Pass moves the *album* to Passed, not the kept track. Show at most six recent Inbox tiles with a real “See all” path.

## Listen

- Rotation contains four user-selected albums. Record entry date when the album actually enters Rotation; do not derive “day in rotation” from a track's Keep date.
- **“Pass” has two incompatible meanings in the draft.** Reserve **Let go** for moving an album to Passed. Call a verified focused listen a *listening pass* in the model; do not use a “Pass” action button to imply that a 30-second preview completed one.
- Until full-play progress and a focused-pass definition exist, show album state and manual **Shelve** / **Let go** actions, but hide pass dots, “ready at five passes,” day-six aging, and automatic bot nudges. Manual Shelve is available by choice; it is never blocked on an unmeasurable pass count.
- Later, a listening pass requires an explicit definition (whole album, one side, or a minimum share of eligible tracks), a user-initiated Listen playback session, verified progress, deduplication for seeking/replays, and explicit exclusion of Ambient playback. Pass-event rows are evidence, not inferred from opening an album or starting a preview. Even after verification, “ready” and “aging” are suggestions; Shelve and Let go remain user actions.
- The collapsed radio strip reports the actual playback state. If radio continues across the intent switch, it cannot say “RADIO PAUSED.” Tapping it takes the listener to Dig without changing audio.

## Ambient

- Ambient means music-first ambient/drone/atmospheric listening, not sleep aids, nature sounds, or white noise. Its bank uses the existing vetted station catalog. An album preset is only playable when the listener explicitly starts an available, supported provider path.
- A work session begins on the listener's explicit Start/Tune action, has a visible end time, and can be ended or extended by the listener. Switching away does not end audio or fabricate listening time. It may end the *work-session label* only when the listener ends it or its clock expires.
- KEEP uses the same recording identity and pending-save rules as Dig. “Kept this session” is a private list of confirmed Keep outcomes attributed to this session, not a separate collection or a public room message. Failed/pending Keeps are labeled accordingly; retry cannot create duplicates.
- The room is quiet in Ambient: no live message stream, automatic bot speech, or notification sound. **Peek** temporarily opens a room view without switching intent or changing audio; dismissing Peek returns to Ambient. “Open inbox” explicitly switches to Dig.

## Shelf drawer

- Open from the visible Shelf control on every intent; gesture is optional enhancement, never the only route. Close with a button/Escape as well as drag. Keep focus in the drawer while open and return it to the opener on close.
- Show a filtered view over the *same* filed Shelf albums. Station matches and Ambient are membership filters, not a change in ownership or ranking. Unknown membership is labeled, not silently dimmed as a non-match.
- A cover selects a card; Play requires explicit user action and a supported playback path. “Add to a preset” chooses a valid bank/slot and does not start playback. Library management remains reachable without closing an active stream.

## The room: release boundary and recommended rules

**Recommendation:** do not launch the draft's one public, site-wide, permanently retained room with the remote. Prototype the middle zone without sendable chat. For a real first release, choose an **invite-only, moderated room** with a clear membership list. Whether it later becomes one public Lore-wide room is a separate product and safety decision.

This conversation room is distinct from Lore's existing private Apple Music playback rooms; do not reuse their short join codes, membership, playback authority, or event history as chat authorization.

1. **Identity and membership.** Lore's `lore_sid` identifies a listener's device for personal state, not an accountable public-chat identity. A real shared room needs durable, verified actor identity and explicit membership; do not equate a Spotify connection or a disposable device cookie with permission to speak. Until that exists, the room is read-only/non-sendable. The host/moderator can invite/remove members; leaving stops future access. Chat membership does not grant access to another person's Library or provider account.
2. **Scope.** Start with one chronological feed *per invited room*. Dig and Listen can show it with different nearby context; “album-scoped” is a clearly labeled filter on album-linked messages, not a hidden new audience or automatically shared private album state. A user must deliberately post a spin card or album reference. No cross-room forwarding or importing Slack channel history by default.
3. **Message shape.** Human text, opt-in spin cards, and bot replies are distinct types with stable author, creation time, room ID, and optional canonical references. Store source records on bot factual claims, not a free-form model-produced `sources[]` string. Message order and pagination use server IDs/cursors; reconnect fetches missed messages. Retried sends carry idempotency keys.
4. **Retention and controls.** Replace “HISTORY SAVED” / “keep all” with a published retention rule; **proposed first-release default: 30 days** of visible chat history. A member can hide their message; moderators can redact/remove content and mute/remove a member. Keep only the minimal audit facts needed for enforcement; a redacted body must not remain visible in history, bot context, exports, or notifications. Provide report/block controls, rate limits, spam/link handling, and a clear moderator owner *before* enabling sends. Presence counts are approximate and ephemeral; do not expose everyone's activity history.
5. **Privacy.** Room posts are visible to room members. Keeps, focused listens, personal taste, and album workflow state stay private unless the listener explicitly shares a specific card. The bot must not pull another member's private data or carry personal memory from Slack into the room. No credentials or provider tokens enter room messages or bot prompts.
6. **Jam Bot.** Keep the Slack bot working during the experiment; a Lore-room adapter should share only appropriate evidence/answer behavior, not Slack user identities or entire transcripts. `@jambot` is an explicit trigger. No unsolicited factual posts or auto-actions in version one. If a claim is factual, each claim needs a valid source reference tied to retrieved evidence; a tag such as `SRC · WIKIDATA` alone is not proof. MusicBrainz/Wikidata and verified Lore observations may support their respective claims; Wikipedia remains an outbound link, not a cited fact source under this spec. A source failure or uncertain recording identity yields a short limitation. “Your focused plays” cannot be a factual source until verified pass events exist.
7. **Action chips.** Chips carry typed, server-validated actions, not arbitrary model text or URLs. Tune and Queue require a listener tap; filing or other lasting changes require a tap and confirmation that shows the target. Re-check ownership, room membership, and current album/station state at execution time. A stale or failed chip explains what happened without claiming success.

## Decisions before implementation

| Decision | Recommendation | Needed before |
| --- | --- | --- |
| Room audience | Invite-only first; public site-wide later only with a moderation plan and stable identity. | Real sendable room |
| Room retention | 30 days of visible history; publish exact policy and redaction/audit limits. | Real sendable room |
| Listening pass | Do not count previews; decide eligible playback and album completion threshold with verified full-play data. | Pass dots, five-pass readiness, aging nudges |
| Unresolved | Keep reachable under `⋯` and the existing Library workflow; don't erase it with the new navigation. | Nav replacement |
| Source labels | Existing Void/Tallow/Nebula Sans/Plex Mono tokens; five presets; confirmed meter states; sourced factual bot claims only. | Visual prototype |

## Acceptance examples

- Switching among all three intents during a playing stream neither pauses nor retunes it; explicit preset tap does.
- A scan landing without a fresh station observation never claims that a particular song is now playing.
- Two devices race to fill the fourth Rotation slot: only one succeeds and the other sees “Rotation full”; neither album vanishes.
- A kept recording is still owned after its candidate album is moved to Passed; shelving an album never fakes a kept recording.
- A 30-second preview and an Ambient album play create zero verified listening passes.
- Opening/closing Shelf and Ambient Peek never changes playback; all drawer controls work without gestures.
- A non-member cannot read, post, or retrieve room history; a redacted message is not served again on reconnect.
- Jam Bot cannot invent a source tag or execute a filing/tune action itself; unsupported claims say evidence is insufficient.