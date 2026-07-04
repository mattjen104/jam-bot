---
name: NTS API datacenter block
description: NTS Live API and all nts.live API endpoints block datacenter IPs via CloudFront WAF; stream also needed crossOrigin fix.
---

## The rule

NTS Live API (`nts.live/api/v2/live/{channel}` and all other `/api/v2/*` paths) returns HTTP 400 with `x-cache: Error from cloudfront` from any Replit IP (dev or prod). The block is IP-range based (datacenter ranges), not key/auth based.

**Why:** NTS uses CloudFront WAF rules that drop non-residential/datacenter IP ranges. This is a silent content policy, not a documented API restriction.

## Stream playback fix

The audio element must NOT use `crossOrigin="anonymous"`. NTS streams redirect through multiple cross-origin hops:
`stream-relay-geo.ntslive.net` (no CORS headers) → `streams.radiomast.io` → `audio-edge-*.mia.g.radiomast.io`

With `crossOrigin="anonymous"`, the browser enforces CORS on each hop and kills the request at the first headerless 302. Without it, the browser follows redirects normally.

**How to apply:** If any stream uses a multi-hop geo-redirect, `crossOrigin="anonymous"` will break it. Only set it when you need WebAudio API access (analyser nodes, etc.) — which Lore doesn't use.

## Show metadata workaround

Server-side NTS API calls always fail. Browser-side calls from residential IPs work fine (same API, `access-control-allow-origin: *` on 200 responses).

**Pattern used:** `useNtsChannel1()` / `useNtsChannel2()` in `src/hooks/useNtsClientLive.ts` — `useQuery` hooks that fetch the NTS Live API directly from the user's browser, refetch every 2 min, return null on any failure. Home.tsx overlays the result into `pulseBySlug` for `nts-1` / `nts-2` when the server pulse has no show data.

**How to apply:** Any metadata that NTS exposes in their API must be fetched client-side (browser) and overlaid onto server data. Never route it through the api-server — it will always get 400.
