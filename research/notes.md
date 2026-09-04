# Research Notes: Lore stations with recurring artist interviews and live sessions

**Status:** completed  
**Method:** Five distinct web searches were made for KEXP, KCRW, KUTX, WXPN, and
WFUV programming. Official pages were then fetched and preserved under
`research/sources/`. The current Lore seed roster was also checked directly.

## Bottom line: ranked active Lore candidates

| Rank | Lore station | Evidence type | Confidence | Why it ranks here |
|---:|---|---|---|---|
| 1 | **KEXP (kexp)** | **Direct recurring live-performance franchise.** KEXP calls *Live On KEXP* its “official audio feed,” says it contains the audio-only version of **every full performance** published on the day it reaches YouTube, and describes thousands of performances. The page has a continuing episode list with separate artists performing live in the KEXP studio. | **High** for recurring sessions; **medium** for talk/interviews in the live linear stream | The clearest confirmed, station-produced performance series among current Lore stations. It is an especially strong editorial signal for listener-facing “live session” context. |
| 2 | **KUTX 98.9 FM (kutx)** | **Direct recurring in-studio franchise and interview vertical.** Its official navigation puts “Studio 1A Sessions,” “Interviews,” “Pop-Up Sessions,” and a performance calendar under “Sessions & Interviews.” The Studio 1A collection is paginated and contains current, explicitly titled “Live In Studio 1A” entries. | **High** for recurring sessions; **high** that KUTX produces artist-interview content; **medium** that any particular live tune-in includes it | This is the strongest direct interview-plus-session evidence in the active Lore roster. |
| 3 | **KALX 90.7 FM (kalx)** | **Direct recurring artist interviews broadcast on KALX.** Its official, paginated Podcasts index includes multiple recent “Artist Interview” posts and explicitly says individual interviews were broadcast from the KALX studios or “over the KALX airwaves.” | **High** for recurring artist interviews; **medium** for a random live tune-in | This is the most direct proof of artist conversation being aired by a college/freeform Lore station, rather than merely hosted online. |
| 4 | **WFMU 91.1 FM (wfmu)** | **Direct station claim of live in-studio performances and interviews, plus an upcoming-guests/specials link.** The official Notable Guests page says WFMU has hosted “a wide array” on its airwaves. | **Medium** | Strong candidate for occasional sessions/interviews, but the evidence is cumulative/historical and does not name a currently recurring weekly franchise. |
| 5 | **KCSM 91.1 FM (kcsm)** | **Direct interview policy.** Its official request page says interviews are recorded and may air later or be made into a podcast, and limits them to one per year per interviewee. | **Medium** for interviews; **low** for live sessions | Confirms an actual station interview pipeline, but not a frequent, scheduled series or real-time stream carriage. |
| 6 | **KAOS 89.3 FM (KAOS callsign candidate)** | Official In-Studio Sessions page solicits in-studio interviews/sessions, says it has hosted artists and speakers on its airwaves, and points to an archive. | **Medium-low** | There is direct format evidence but also a stated limited booking capacity and much of the displayed video material is old; verify an active Lore station row/stream before promotion. |
| 7 | **dublab (dublab)** | Roster presence and a scheduled independent stream; **no fetched official recurring interview/session franchise evidence in this pass.** | **Low** | Do not infer interviews or artist context from its curated-programming reputation alone. |
| 8 | **KCRW — Eclectic 24 (kcrw-eclectic24)** | The requested *Morning Becomes Eclectic* page was rate-limited (HTTP 429) during research; more importantly, Lore currently seeds **Eclectic 24**, not a separately identified MBE live program/station. | **Low / not verified for this Lore stream** | Do not transfer MBE’s reputation to Eclectic 24 without schedule/stream-specific proof that MBE airs there. |

## Direct evidence versus weaker proxies

### Directly verified recurring formats

1. **KEXP — Live On KEXP**  
   The official KEXP page explicitly identifies an ongoing audio feed for live
   sessions, describes a large archive, and lists multiple studio-performance
   episodes. This supports recurring production, rather than an isolated music
   news post.

2. **KUTX — Studio 1A Sessions / Sessions & Interviews**  
   The official collection page is a recurring category (with a next page), not
   a single story. The site independently exposes recurring Studio 1A,
   interviews, pop-up sessions, and performance-calendar sections.

3. **KALX — artist interviews on the air**  
   The official Podcasts archive is paginated and contains numerous distinct
   artist interview entries. Unlike a generic interview-request form, several
   entries explicitly say the interview was broadcast on KALX airwaves.

4. **WFMU — live in-studio performances and interviews**  
   WFMU’s official Notable Guests page explicitly describes live in-studio
   performances and interviews on its airwaves, while pointing to current
   upcoming guests/special programs. This demonstrates the format, but the
   lengthy guest list is not a schedule or frequency guarantee.

### Explicitly *not* treated as proof

- **Playlist logging / spin history:** shows what was played, not that a
  presenter spoke knowledgeably between songs.
- **A human-DJ schedule:** is useful lead-generation only. It does not prove
  interview frequency or live performance programming.
- **An artist-session archive:** confirms station production, but not
  necessarily that sessions appear in the station’s uninterrupted live stream
  at a predictable time.
- **KCRW MBE, WXPN/World Cafe, WFUV, WTMD/NPR Live Sessions, KALW, WBEZ/Vocalo,
  and college/freeform possibilities:** none should be claimed as *active Lore
  candidates* from this review unless their station slug/stream is verified in
  the active Lore roster. WXPN’s official World Cafe page was fetched as a
  useful comparator, but no WXPN entry was found in the current seed roster.

## Important caveats and product use

- Rank KEXP and KUTX as **“has recurring station-produced sessions”**, not
  “will play an interview right now.” The official pages establish the
  franchises, not exact carriage/frequency in the currently tuned live feed.
- For spoken context, add a program-level schedule or sampled-audio signal
  before making a real-time promise. KEXP’s performance page does not itself
  establish artist interviews; KUTX’s separate Interviews vertical does.
- KCRW’s 429 response is a collection failure, not evidence that MBE has
  stopped. It remains a follow-up candidate if Lore adds/identifies the
  flagship KCRW stream rather than Eclectic 24.
- This pass deliberately favors reliable, recurring, first-party evidence over
  broad station reputation.

## Source list

Fetched pages are saved verbatim in `research/sources/`.

1. KEXP, “[Live On KEXP](https://www.kexp.org/podcasts/live-on-kexp/)” —
   official podcast/session index. Saved as
   `www.kexp.org_podcasts_live-on-kexp_.html`.
2. KUTX, “[Studio 1A Sessions](https://kutx.org/category/sessions-interviews/studio1a/)” —
   official paginated collection. Saved as
   `kutx.org_category_sessions-interviews_studio1a_.html`.
3. KUTX, “[Studio 1A and Special Guest Parking](https://kutx.org/uncategorized/studio-1a-and-special-guest-parking/)” —
   official page whose site navigation exposes the Sessions & Interviews,
   Studio 1A Sessions, Interviews, and Pop-Up Sessions verticals. Saved as
   `kutx.org_studio-1a_.html`.
4. WXPN, “[World Cafe](https://www.xpn.org/world-cafe/)” — official comparator,
   not promoted because WXPN was not found in the current Lore seed roster.
   Saved as `www.xpn.org_world-cafe_.html`.
5. KCRW, “[Morning Becomes Eclectic](https://www.kcrw.com/music/shows/morning-becomes-eclectic)” —
   attempted official fetch; saved HTTP-429 response as
   `www.kcrw.com_music_shows_morning-becomes-eclectic.html`. A podcast endpoint
   retry is saved separately and was also rate-limited.
6. KALX, “[Podcasts](https://kalx.berkeley.edu/blog/podcasts/)” — official,
   paginated archive of interviews, including entries explicitly broadcast on
   KALX. Saved as `kalx-podcasts.md`.
7. WFMU, “[Notable Guests](https://wfmu.org/notable-guests)” — official page
   stating that WFMU has hosted live in-studio performances and interviews.
   Saved as `music-talk-03-wfmu-notable-guests.md`.
8. KAOS, “[In-Studio Sessions](https://www.kaosradio.org/in-studios)” —
   official sessions and interview booking page. Saved as
   `kaos-in-studio-sessions.md`.
9. KCSM, “[Interview Request](https://www.kcsm.org/interviews)” — official
   interview policy and possible air/podcast disposition. Saved as
   `kcsm-interview-request.md`.

## Lore-roster check

`artifacts/api-server/src/lore/seed.ts` currently includes the slugs `kexp`,
`kutx`, `kcrw-eclectic24`, `dublab`, `wfmu`, `kalx`, and `kcsm`. `KAOS` is in
the station-identity/callsign candidates and needs a final active-row check. It
did not contain matching entries for WXPN, WFUV, WTMD, KALW, WBEZ, or Vocalo.