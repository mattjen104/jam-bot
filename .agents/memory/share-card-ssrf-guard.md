---
name: Share-card SSRF guard
description: Server-side artwork fetch for OG share cards must SSRF-guard attacker-influenced URLs with per-hop redirect validation.
---

Artwork URLs stored in the DB come from external metadata feeds, so any public endpoint that fetches them server-side (e.g. og:image card rendering) is an SSRF surface.

**Rule:** validate before every fetch — https-only, no credentials in URL, reject localhost/.local/.internal, reject private/loopback/link-local/CGNAT/multicast IPs (both IP literals and DNS-resolved addresses, incl. ::ffff: mapped v4).

**Why:** the card endpoint triggers the fetch on demand, letting anyone probe internal/link-local services (e.g. 169.254.169.254 metadata) via a crafted artwork URL. Flagged by architect review as a blocking issue.

**How to apply:** don't use `redirect: "error"` — Cover Art Archive 307s to archive.org, so artwork would silently vanish. Follow redirects manually (cap ~3 hops) and re-run the full guard on every hop. Guard helpers + tests live with the share layer (`isPrivateIp`, `isSafeArtworkUrl`).
