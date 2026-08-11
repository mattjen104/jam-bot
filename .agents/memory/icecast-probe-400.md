---
name: Icecast 400-on-HEAD probing
description: Why curl -I / plain HEAD makes healthy Icecast streams look broken, and how the stream relay decides HTTP-only vs HTTPS.
---

# Icecast servers return 400 to bare HEAD probes

Several college-radio Icecast 2.4.x servers (WHPK, WZBC, WXDU and others)
answer `curl -I` / plain HEAD with **400 Bad Request** while the stream is
perfectly healthy. A GET with `Icy-MetaData: 1` returns 200 + audio.

**Why:** Icecast treats a HEAD (or a GET without stream-client headers) as a
malformed source/client request on some configs. A 400 from a probe is NOT
evidence the stream is down.

**How to apply:** when verifying stream URLs, probe with
`curl -H "Icy-MetaData: 1" --max-filesize 20000 -D - -o /dev/null <url>` and
judge by the GET status + `Content-Type: audio/*`. Several "HTTP-only"
stations turned out to have working HTTPS endpoints once probed correctly —
always retry the https:// variant of an http:// stream host before assuming a
relay is needed.

Related: the stream relay (`stream-relay.ts`) only serves allowlisted slugs
whose DB streamUrl is plain `http://`; `toStation()` only emits `relayUrl`
under the same condition, so putting an HTTPS-capable station on the
allowlist is harmless.
