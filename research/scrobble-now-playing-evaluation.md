# Scrobble now-playing source evaluation

Research date: 2026-09-16 UTC  
Scope: Last.fm and Rocksky as possible lower-cost station now-playing sources for Lore  
Decision: **Do not add either service to the production adapter ladder.**

## Executive recommendation

| Source | Recommendation | Suitable station class | Why |
|---|---|---|---|
| Station first-party API/history | Production source | Stations publishing an official feed | Direct station evidence, stable IDs/timestamps where available |
| ICY watcher or 30-second ICY poll | Remain authoritative | Stations whose own stream emits usable metadata | Direct station transport; no account identity or abandonment risk |
| Last.fm | Discovery/corroboration experiment only | Tiny manually verified allowlist of station-operated accounts | API key required, discretionary limits, no ownership attestation or reliable current-track timestamp |
| Rocksky actor history | Discovery signal only | No verified station class found | Public actor history is listener activity, not a station feed |
| Rocksky expiring status | Reject for fleet ingestion now | No verified station class found | Optional record, usually absent in tested PDSes; depends on actor/PDS availability |

ICY must remain authoritative for station identity and track boundaries wherever a first-party station API is unavailable. Scrobble sources can be wrong while returning perfectly valid data because they describe an account's client, not the station's transmission.

## Identity evidence rule

An account can be classified `verified` only with:

1. a station-controlled page linking the exact account, or written confirmation by the station; **or**
2. a pre-registered comparison of at least 24 hours that repeatedly agrees with the station's first-party history/ICY across track changes, with no unrelated plays, simultaneous-source contamination, unexplained gaps, duplicate/reordered sequences, or account inactivity.

A matching username, profile display name, one matching track, or a Last.fm community wiki is only `candidate` evidence. Ordinary public users are `listener_control`. Candidate/control observations must never write spins.

## Candidate inventory

| Station/account | Service | Evidence | Classification |
|---|---|---|---|
| BBC 6 Music / `bbc6music` | Last.fm | Long-lived branded profile; Last.fm community page says the account scrobbles station plays. No BBC-controlled link found in this pass. | Candidate |
| BBC Radio 1 / `bbcradio1` | Last.fm | Long-lived branded profile; Last.fm community page links it. No BBC-controlled link found in this pass. | Candidate |
| BBC 1Xtra / `bbc1xtra` | Last.fm | Long-lived branded profile; no station-controlled ownership evidence found. | Candidate |
| KEXP, KCRW, NTS | Last.fm | No defensible station-operated account found. | None |
| `radioday`, `fm-bot` | Last.fm | Public/listener or automation accounts, not station-controlled evidence. | Listener controls |
| `vicwalker.dev.br`, `aly.codes`, `maccalennon.com`, `karlbrig.ht` | Rocksky | Public personal actors observed in actor/feed/PDS probes; no station affiliation. | Listener controls |
| Lore stations generally | Rocksky | No verified station-owned Rocksky actor found. | None |

Candidate URLs:

- https://www.last.fm/user/bbc6music
- https://www.last.fm/user/bbcradio1
- https://www.last.fm/user/bbc1xtra
- https://www.last.fm/user/radioday
- https://www.last.fm/user/fm-bot

## Live observations

All observations below were made 2026-09-16 05:13–05:15 UTC.

### Last.fm

- `user.getRecentTracks` without `api_key` returned HTTP 400, 89 response-body bytes, error 6 (missing required parameter), in 101 ms.
- The same request with a placeholder key returned HTTP 403, 85 bytes, error 10 (invalid API key), in 56 ms.
- Public profile HTML returned HTTP 406 from this environment and is not a dependable machine-readable fallback.
- No Last.fm credential was available. Therefore successful response bytes, cache headers, live agreement, lag, gaps, duplicates, and reorder rates are **not measured**. Reporting an agreement percentage would be fabricated.
- API semantics: `nowplaying="true"` identifies the current item. Completed rows have `date.uts`; the current row in the documented shape has no dependable start timestamp. Pagination (`page`, `from`, `to`, `limit` up to 200) is history of an account, not proof of station history.

### Rocksky AppView history

- `GET https://api.rocksky.app/xrpc/app.rocksky.actor.getActorScrobbles?did=vicwalker.dev.br&limit=1` returned HTTP 200 and 843 response-body bytes.
- The first row was Angela Aki — “This Love”, with `createdAt=2026-09-11T02:29:28.857Z`: five days old at observation time. It is clearly history, not now-playing.
- Handle and DID forms each returned data. `limit=2` responses measured 1,660 bytes; `offset=2` measured 1,771 bytes; a far-past offset returned `{"scrobbles":[]}` (16 bytes). An invalid handle returned HTTP 400 (81 bytes).
- Offset pagination is stable enough for an experiment but has no documented snapshot/cursor consistency guarantee.
- The public feed returned personal users and unrelated tracks. This is direct false-attribution evidence: valid Rocksky data cannot be assigned to a station without separate identity proof.

### Rocksky status and PDS

- Handle resolution through `com.atproto.identity.resolveHandle` was public and returned a DID.
- DID documents exposed each actor's AT Protocol PDS. Direct `com.atproto.repo.getRecord`/`listRecords` reads were public.
- The `app.rocksky.actor.status` lexicon uses rkey `self`, requires a track and `startedAt`, and permits `expiresAt`. A consumer must reject a record after `expiresAt`; receipt time cannot substitute for a track boundary.
- The tested public/self-hosted PDS actors (`vicwalker.dev.br`, `aly.codes`, `maccalennon.com`, and `karlbrig.ht`) had no status record. Empty status collection responses measured 14 bytes.
- `app.rocksky.actor.status` is a repository record, not an AppView query; calling it as an AppView XRPC method returned 404.
- PDS availability, DID resolution, optional record publication, actor client behavior, and AppView indexing are separate failure points. A self-hosted PDS is publicly readable when online but is not a reliability guarantee.

### Alignment, lag, gaps, and ordering result

No defensible station-to-account pair was available for simultaneous Last.fm/Rocksky/ICY measurement:

- Last.fm successful reads were blocked by the required API key.
- No station-owned Rocksky actor was found.
- Rocksky controls were personal accounts with unrelated tracks.

Accordingly:

| Metric | Last.fm | Rocksky |
|---|---|---|
| Track agreement with ICY | Not measured | No station pair; control accounts disagree by identity |
| Lag | Not measured | Actor-history sample was 5 days old; not current |
| Gaps | Not measured | Status absent on all four tested actors |
| False attribution | Structural risk | Demonstrated by unrelated personal public actors |
| Duplicate/reordered scrobbles | Not measured | Not observed in tiny sample; offset API provides no snapshot guarantee |
| Account inactivity | Candidate profiles active historically, live API not measured | Demonstrated by old actor-history sample and absent statuses |

This absence of an evaluable station pair is itself a deployment result: neither provider currently offers a discoverable, attestable station-account surface.

## Request, bandwidth, and server cost

### Measured and modeled values

Calls/day are exact for the cadence. Bandwidth values below use explicit planning assumptions where a successful payload was unavailable:

- ICY short poll: 30 seconds, one TCP/TLS setup, assumed 16 KiB to first metadata block. Actual bytes depend on `icy-metaint`, bitrate, headers, and redirects.
- Persistent watcher: assumed 128 kbit/s audio transfer, one open socket/station. Actual leased watchers prefer lower-bitrate mounts.
- Last.fm: 60 or 120 seconds, assumed 15 KB successful `limit=2` JSON. **Unmeasured without key.**
- Rocksky history: 60 or 120 seconds, 1.66 KB measured for `limit=2`.
- Rocksky status cold lookup: up to three requests (handle, DID doc, PDS record); production could cache handle/DID/PDS mappings, but status itself remains one PDS request/poll.

| Fleet | Source/cadence | Calls/day | Average calls/s | Transfer/day |
|---:|---|---:|---:|---:|
| 100 | ICY poll / 30s | 288,000 | 3.33 | ~4.72 GB |
| 500 | ICY poll / 30s | 1,440,000 | 16.67 | ~23.59 GB |
| 1,000 | ICY poll / 30s | 2,880,000 | 33.33 | ~47.19 GB |
| 100 | Last.fm / 60s | 144,000 | 1.67 | ~2.16 GB assumed |
| 500 | Last.fm / 60s | 720,000 | 8.33 | ~10.80 GB assumed |
| 1,000 | Last.fm / 60s | 1,440,000 | 16.67 | ~21.60 GB assumed |
| 100 | Rocksky history / 60s | 144,000 | 1.67 | ~0.24 GB measured-size model |
| 500 | Rocksky history / 60s | 720,000 | 8.33 | ~1.20 GB measured-size model |
| 1,000 | Rocksky history / 60s | 1,440,000 | 16.67 | ~2.39 GB measured-size model |

At 120 seconds, call and transfer totals are half the 60-second values, but any now-playing-only source can miss tracks shorter than the cadence and can add up to one cadence of observation lag.

Persistent 128 kbit/s watchers consume about 1.38 GB/station/day: 100/500/1,000 continuous sockets transfer roughly 138 GB/691 GB/1.38 TB per day. Lore's actual 40-socket default budget caps this exposure at roughly 55 GB/day before protocol overhead; the rest use polling or host multiplexing.

### Operational comparison

| Concern | ICY | Last.fm | Rocksky |
|---|---|---|---|
| Credentials | None | API key required; user auth not required for reads | None for tested public reads |
| Published hard quota | Station-specific | No dependable numeric quota in official cited docs; suspension/error 29 possible | No fleet SLA established |
| Connection/socket work | Poll setup or leased open socket; stream parser CPU | HTTPS/JSON per account poll | AppView HTTPS/JSON; status may require DID/PDS discovery |
| DB work if authoritative | Existing spin/change pipeline | Would add dedup/cursor work | Would add dedup/cursor/federation handling |
| Short tracks | Watcher immediate; 30s poll bounded | Can be missed/delayed by client/cadence | History may recover later; status can be absent |
| Outage domain | Station/stream host | Shared Last.fm API/key/account | AppView + DID resolver + actor PDS/client |
| Silent abandonment | Stream health is observable | Account can stop scrobbling | Actor/status can disappear or expire |
| Shared-account contamination | Not applicable | Possible and hard to distinguish | Possible and hard to distinguish |

Lower transferred bytes do not compensate for invalid station identity. These providers would reduce parser/socket cost only by moving correctness and availability to an unverified account.

## Experiment implementation boundary

The non-writing runner is:

```text
artifacts/api-server/src/scripts/run-scrobble-source-experiment.ts
```

It requires a JSON config containing `experimentOnly: true`, uses bounded concurrency (maximum 5), a shared per-provider request gate (250 ms by default), provider timeouts, configurable sample spacing, JSONL observations, and a summary. It imports no database, resolver, poller, or spin-ingestion module. `--write`, `--ingest`, and `--apply` are rejected. Actor-controlled DID/PDS requests require HTTPS, reject private/special-use DNS results, pin each request to its validated public address, and manually revalidate every redirect. Each invocation truncates its observation file and stamps every row and summary with a unique run ID.

Example config:

```json
{
  "experimentOnly": true,
  "targets": [
    {
      "stationSlug": "bbc-6music",
      "lastfmUser": "bbc6music",
      "identityConfidence": "candidate",
      "identityEvidenceUrl": "https://www.last.fm/user/bbc6music"
    },
    {
      "stationSlug": "listener-control",
      "rockskyActor": "vicwalker.dev.br",
      "identityConfidence": "listener_control"
    }
  ]
}
```

Run:

```sh
LASTFM_API_KEY=... pnpm --filter @workspace/api-server exec tsx \
  src/scripts/run-scrobble-source-experiment.ts \
  --config=research/scrobble-targets.json --samples=24 --interval-seconds=60
```

The runner records provider timestamps and expiration but does not infer a start from receipt time. Agreement metrics compare only observations explicitly marked current; Rocksky history and expired statuses remain incomparable and are available for separate sequence/lag analysis. ICY byte counts remain zero because the existing bounded fetch API does not expose transport bytes; the report labels its bandwidth as modeled.

## Legal and policy constraints

- Last.fm API terms permit the service to impose request/user limits, require HTTP cache compliance, and require additional permission for commercial use. A production review would need to confirm Lore's intended use with current terms.
- Rocksky/AT Protocol public readability is not an ownership attestation. Public records remain user-controlled and can be edited/deleted or become unavailable with a PDS.
- Neither service's public actor data grants permission to reinterpret a listener as a station.

Sources:

- https://www.last.fm/api/show/user.getRecentTracks
- https://www.last.fm/api/intro
- https://www.last.fm/api/tos
- https://www.last.fm/api/authentication
- https://docs.rocksky.app/api-reference/approckskyactor/get-scrobbles-for-an-actor.md
- https://docs.rocksky.app/api-reference/approckskyfeed/get-all-currently-playing-tracks-by-users.md
- https://raw.githubusercontent.com/tsirysndr/rocksky/main/apps/api/lexicons/actor/status.json
- https://atproto.com/specs/did

## Rollout gate if revisited

Do not build a production adapter until all are true:

1. a station-controlled account attestation exists;
2. a credentialed, non-writing 24-hour comparison has at least 100 track transitions;
3. agreement, lag p50/p95, gap rate, duplicate/reorder rate, payload bytes, caching headers, and outage behavior are measured;
4. the account has an abandonment alert and cannot be shared with personal listening;
5. legal/API-policy review permits the projected cadence;
6. any adapter is corroboration-only first, feature-flagged per station, and cannot outrank first-party/ICY evidence.

Current evidence does not justify that follow-on adapter.