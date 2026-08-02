# Lore Radio — Pre-Trial Staging Runbook

> **When to use this:** Before any live trial session that will rely on Spotify
> OAuth/import, station now-playing feeds, or MusicBrainz enrichment.  Run
> through every section below and resolve all blocking items before proceeding.

---

## 1 Automated probe (station feeds + config)

The probe script checks Spotify configuration and probes all representative
station feeds without touching the database or sending Slack messages.

```bash
pnpm --filter @workspace/api-server exec tsx src/lore/staging-probe.ts
```

**Interpreting output:**

| Symbol | Meaning |
|--------|---------|
| `✓ [PASS]` | Feed reachable, metadata present — no action needed |
| `⚠ [WARN]` | Feed reachable but metadata absent (airbreak / off-air) *or* rate-limited.  Re-run in a few minutes.  A warn on a feed used during the trial is a blocking issue. |
| `✗ [FAIL]` | Feed unreachable or config missing.  Resolve before the trial. |

**Common failures and fixes:**

| Check | Failure | Fix |
|-------|---------|-----|
| Spotify config | `SPOTIFY_CLIENT_ID` or `SPOTIFY_CLIENT_SECRET` missing | Set both secrets in the Replit environment via `.local/skills/environment-secrets` |
| API server reachability | `ECONNREFUSED` on localhost | Start the API Server workflow first |
| Any station | Timeout after 10 s | Re-run — transient network issue.  If persistent, the source is degraded. |
| Any station | HTTP 429 | Rate-limited.  Note the `retry-after` header, wait, and re-run. |

Exit code 0 = all checks passed.  Exit code 1 = one or more FAIL checks.

---

## 2 Spotify OAuth connect (manual — requires a browser)

Use a **non-production Spotify account** (a personal free or premium account
not used for real listening data).

### 2a Connect

1. Open the Lore app in a browser (the preview pane or `$REPLIT_DEV_DOMAIN/lore/`).
2. Click **Connect Spotify**.
3. Authorize on Spotify's consent screen.
4. Verify the app returns to Lore with the account name visible.
5. Call `GET /api/spotify/status` and confirm:
   ```json
   { "configured": true, "connected": true, "displayName": "<your name>", "product": "premium"|"free" }
   ```

### 2b Import progress

1. Click **Import Library** (or call `POST /api/me/library/import?service=spotify`).
2. The response should be `202 Accepted` with a `jobId`.
3. Poll `GET /api/me/library/import/<jobId>` until `status` transitions:
   - `pending` → `running` (within ~5 s)
   - `running` → `done` (duration depends on library size; a 100-track account
     finishes within 3–5 minutes under normal MB rate-limit conditions)
4. Confirm terminal state:
   ```json
   { "status": "done", "total": N, "resolved": M, "unresolvedCount": U }
   ```
   `M / N ≥ 0.8` is healthy (≥ 80 % resolution rate).  Below 80 % means MB
   was slow or the library has many obscure tracks — check for `error` field
   and MB 503 back-off messages in the API server logs.

### 2c Rate-limit behaviour

If the import hits a Spotify 429:
- The job will finish with `status: "error"` and `error` containing `Retry-After: <N>`.
- Starting a new import before the window expires returns `HTTP 429` with
  `retryAfterSec` in the body.
- Log the `retryAfterSec` value and the time it was hit.  Wait the indicated
  period before retrying.

### 2d Disconnect

After the trial run, disconnect the test account:
1. Call `POST /api/spotify/logout`.
2. Confirm `GET /api/spotify/status` returns `{ "connected": false }`.

---

## 3 Station feed spot-checks (manual)

After the automated probe passes, verify a sample of curated stations in the
Lore UI:

| Station | Source type | Expected behaviour |
|---------|-------------|-------------------|
| KEXP | `kexp_api` | Now-playing track with artist/title in the station card |
| BBC Radio 6 Music | `bbc_api` | Show or track name visible |
| NTS 1 & 2 | `nts_live` | Current show name visible on both channels |
| Radio Paradise | `radio_paradise` | Artist/title with artwork |
| SomaFM Groove Salad | `somafm` | Track visible (updates ~every 4 min) |

**What "visibly degraded" means:**
- The station card shows a spinning placeholder for > 2 poll intervals.
- The now-playing text reads "Unknown" or is empty.
- The timeline shows no plays for > 30 minutes during a period when the station
  is broadcasting.

Log any degraded station with: station slug, source type, time observed, and
whether the automated probe also showed a warn/fail for that source.

---

## 4 MusicBrainz enrichment spot-check

MusicBrainz rate-limits unauthenticated requests to 1 req/s.  The import
worker respects this automatically (`IMPORT_RESOLVE_DELAY_MS = 1100 ms`), but
sustained 503s trigger an exponential back-off (base 30 s, max 5 min).

To verify enrichment is healthy:
1. After the import completes, pick three tracks from the library.
2. For each, call `GET /api/me/library` and confirm `mbid` is non-null.
3. If `unresolvedCount` in the import job response is high (> 20 %), check the
   API server logs for `[lore] MB 503` or back-off messages.

If MB is returning sustained 503s during the trial:
- The import worker will pause and retry automatically — no intervention needed.
- Log the back-off start time and the first recovery time.
- The off-peak Phase 3 retry scheduler (2–6 AM UTC) will attempt unresolved
  tracks on subsequent nights.

---

## 5 Slack guard

The staging runbook covers a **development/staging** environment only.
The `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` secrets are present but the
jam-bot only sends messages when the Slack socket is connected and a Jam
session is active.

To confirm no Slack messages are sent during the staging check:
- Do **not** start the jam-bot process during the probe or import runs.
- Verify the Slack workspace shows no new bot messages after the session.

---

## 6 Sign-off checklist

Before the trial, confirm every item below:

- [ ] `staging-probe.ts` exits 0 (all PASS)
- [ ] Spotify env vars set (`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`)
- [ ] Test account connected and disconnected cleanly (section 2)
- [ ] Import completed with ≥ 80 % resolution rate
- [ ] Spotify rate-limit window (if hit) noted and expired
- [ ] Station spot-checks pass (section 3)
- [ ] MusicBrainz enrichment healthy or back-off logged (section 4)
- [ ] No Slack messages produced during staging (section 5)
- [ ] Any degraded stations logged with slug + source + observed time

---

## 7 Retry table (rate-limit reference)

| Service | Rate-limit signal | Retry-After source | Worker behaviour |
|---------|------------------|--------------------|-----------------|
| Spotify import | HTTP 429 + `Retry-After` header | `library_import_jobs.error` field | Rejects new import starts until window expires |
| MusicBrainz | HTTP 503 | Back-off starts at 30 s, doubles, caps at 5 min | Phase 3 worker pauses; Phase 3 retry scheduler re-attempts 2–6 AM UTC |
| Odesli (share links) | HTTP 429 | `x-ratelimit-reset` | Per-call cache; retried on next request |
| Station adapters | HTTP 429 or timeout | `retry-after` header (logged by probe) | Next poll tick; no special back-off |
