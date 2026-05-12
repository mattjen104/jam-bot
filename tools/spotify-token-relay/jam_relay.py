#!/usr/bin/env python3
"""
Spotify Token Relay (Python edition)
====================================

Single-file, standard-library-only equivalent of index.mjs. Same behavior,
same endpoints, same env vars — but you only need Python 3.8+ (no Node,
no npm install, no cloning required if you don't want to). Save this
file anywhere on your home computer and run:

    # PowerShell (Windows):
    $env:SPOTIFY_SP_DC  = "paste-your-sp_dc-cookie"
    $env:RELAY_SECRET   = "paste-your-saved-secret"
    python jam_relay.py

    # bash / zsh (macOS, Linux):
    SPOTIFY_SP_DC="..." RELAY_SECRET="..." python3 jam_relay.py

Why this exists: Spotify blocks `open.spotify.com/get_access_token` from
datacenter IPs, so the bot can't call it directly from the droplet. This
relay runs on your home network (residential IP), holds the sp_dc cookie
locally, and returns short-lived access tokens to the droplet over an
authenticated request through a Cloudflare quick tunnel.

Endpoints:
    GET /token   (Authorization: Bearer <RELAY_SECRET>)
        -> 200 { accessToken, accessTokenExpirationTimestampMs,
                 isAnonymous, fromCache }
        -> 401 if the bearer secret is missing or wrong
        -> 502 if Spotify rejected the cookie or returned non-2xx

    GET /health  -> 200 { ok: true }

Security:
    - sp_dc cookie NEVER leaves this machine.
    - All other access is gated by RELAY_SECRET (Authorization: Bearer ...).
    - Binds to 127.0.0.1 by default; expose via cloudflared / ngrok rather
      than opening a router port.

Required env vars:
    SPOTIFY_SP_DC   the sp_dc cookie value from open.spotify.com
                    (DevTools -> Application -> Cookies)
    RELAY_SECRET    long random string; same value as the droplet's
                    SPOTIFY_TOKEN_RELAY_SECRET

Optional env vars:
    RELAY_PORT      default 8787
    RELAY_BIND      default 127.0.0.1
"""

from __future__ import annotations

import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional, Tuple


PORT = int(os.environ.get("RELAY_PORT", "8787"))
BIND = os.environ.get("RELAY_BIND", "127.0.0.1")
SECRET = os.environ.get("RELAY_SECRET", "")
SP_DC = os.environ.get("SPOTIFY_SP_DC", "")

BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)

if not SECRET:
    print(
        "[relay] FATAL: RELAY_SECRET is not set. Generate one with:\n"
        '        python -c "import secrets; print(secrets.token_hex(32))"\n'
        "        Then set it here AND set the same value as "
        "SPOTIFY_TOKEN_RELAY_SECRET on the droplet.",
        file=sys.stderr,
    )
    sys.exit(1)

if not SP_DC:
    print(
        "[relay] FATAL: SPOTIFY_SP_DC is not set. Grab it from open.spotify.com\n"
        "        DevTools -> Application -> Cookies -> sp_dc value.",
        file=sys.stderr,
    )
    sys.exit(1)


# In-process token cache. Spotify tokens are valid ~1 hour; we refresh
# when fewer than 60s remain. The bot caches too, but this cushions any
# bot-side restarts.
_cached_token: Optional[str] = None
_cached_expires_at_ms: int = 0


def fetch_token() -> Tuple[str, int, bool]:
    """Return (access_token, expires_at_ms, from_cache).

    Raises RuntimeError on Spotify-side failures with a short message
    suitable for the response body.
    """
    global _cached_token, _cached_expires_at_ms
    now_ms = int(time.time() * 1000)
    if _cached_token and now_ms < _cached_expires_at_ms - 60_000:
        return _cached_token, _cached_expires_at_ms, True

    req = urllib.request.Request(
        "https://open.spotify.com/get_access_token"
        "?reason=transport&productType=web_player",
        headers={
            "Cookie": f"sp_dc={SP_DC}",
            "User-Agent": BROWSER_UA,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            body = res.read()
            data = json.loads(body)
    except urllib.error.HTTPError as e:
        snippet = ""
        try:
            snippet = e.read().decode("utf-8", "replace")[:200]
        except Exception:
            pass
        raise RuntimeError(
            f"Spotify rejected get_access_token: {e.code} {snippet}"
        ) from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"Network error reaching Spotify: {e.reason}") from e

    token = data.get("accessToken")
    is_anon = bool(data.get("isAnonymous"))
    if not token or is_anon:
        raise RuntimeError(
            "Spotify returned an anonymous token — sp_dc cookie is expired "
            "or invalid. Grab a fresh one from open.spotify.com."
        )

    expires_at = int(
        data.get("accessTokenExpirationTimestampMs")
        or (now_ms + 30 * 60_000)
    )
    _cached_token = token
    _cached_expires_at_ms = expires_at
    return token, expires_at, False


def _check_auth(header_value: str) -> bool:
    """Constant-time compare of the bearer header against RELAY_SECRET."""
    expected = f"Bearer {SECRET}"
    return hmac.compare_digest(header_value, expected)


class RelayHandler(BaseHTTPRequestHandler):
    # Quiet down the default per-request stderr line; we log our own.
    def log_message(self, format: str, *args) -> None:  # noqa: A002
        return

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler API)
        if self.path == "/health":
            self._send_json(200, {"ok": True})
            return
        if self.path != "/token":
            self._send_json(404, {"error": "not found"})
            return

        auth = self.headers.get("Authorization", "")
        if not _check_auth(auth):
            self._send_json(401, {"error": "bad or missing bearer token"})
            print(f"[relay] 401 from {self.client_address[0]}")
            return

        try:
            token, expires_at, from_cache = fetch_token()
        except RuntimeError as e:
            self._send_json(502, {"error": str(e)})
            print(f"[relay] token fetch failed: {e}")
            return

        self._send_json(
            200,
            {
                "accessToken": token,
                "accessTokenExpirationTimestampMs": expires_at,
                "isAnonymous": False,
                "fromCache": from_cache,
            },
        )
        ttl_s = max(0, (expires_at - int(time.time() * 1000)) // 1000)
        print(
            f"[relay] served token (cache={from_cache}, "
            f"expires in {ttl_s}s)"
        )


def main() -> None:
    server = ThreadingHTTPServer((BIND, PORT), RelayHandler)
    print(
        f"[relay] listening on http://{BIND}:{PORT}\n"
        f"[relay] endpoints: GET /token (auth required), GET /health\n"
        f"[relay] expose this to your droplet via cloudflared/ngrok — "
        f"see README.md"
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[relay] shutting down")
        server.server_close()


if __name__ == "__main__":
    main()
