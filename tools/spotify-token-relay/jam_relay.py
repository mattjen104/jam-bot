#!/usr/bin/env python3
"""
Spotify Token Relay (Python edition) — v2, extension-fed
========================================================

Holds the latest Spotify Web Player access token in memory and serves it
to the Jam Bot droplet over an authenticated request through a Cloudflare
quick tunnel.

Tokens are PUSHED IN by the companion Chrome extension running in the
Jam Host's browser. The relay no longer talks to Spotify directly —
Spotify deprecated the unauthenticated `open.spotify.com/get_access_token`
endpoint (HTTP 403 "URL Blocked" via Varnish), so the only reliable way
to get a Web Player token is to harvest it from a real, logged-in
browser session.

Run on your home computer:

    # PowerShell (Windows):
    $env:RELAY_SECRET = "paste-your-saved-secret"
    python jam_relay.py

    # bash / zsh (macOS, Linux):
    RELAY_SECRET="..." python3 jam_relay.py

Endpoints:
    POST /admin/set-token        (Authorization: Bearer <RELAY_SECRET>)
        body: { accessToken, accessTokenExpirationTimestampMs }
        -> 200 { ok: true }
        -> 401 if the bearer secret is missing or wrong
        -> 400 if the body is malformed
        Used by the Chrome extension to push fresh tokens.

    GET /token                   (Authorization: Bearer <RELAY_SECRET>)
        -> 200 { accessToken, accessTokenExpirationTimestampMs,
                 isAnonymous: false, fromCache: true }
        -> 401 if the bearer secret is missing or wrong
        -> 503 if no token has been pushed yet, or the last one expired
        Used by the droplet bot to fetch the current token.

    POST /jam/start              (Authorization: Bearer <RELAY_SECRET>)
        body: {} (ignored)
        -> 200 { ok: true,  joinUrl: "https://open.spotify.com/jam/..." }
        -> 200 { ok: false, reason: "<specific reason>" }
        -> 401 if the bearer secret is missing or wrong
        -> 503 if the driver script is missing
        -> 504 if the driver overran JAM_START_TIMEOUT_SEC
        Spawns jam_start_windows.py to drive the Spotify Desktop UI.
        Calls are serialised by an in-process lock; /token and /health
        keep responding while a jam-start is in flight.

    GET /health                  (no auth)
        -> 200 { ok: true, hasToken, expiresInSec }

Required env vars:
    RELAY_SECRET    long random string; same value as the droplet's
                    SPOTIFY_TOKEN_RELAY_SECRET *and* the Chrome
                    extension's stored secret.

Optional env vars:
    RELAY_PORT      default 8787
    RELAY_BIND      default 127.0.0.1
"""

from __future__ import annotations

import hmac
import json
import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional


PORT = int(os.environ.get("RELAY_PORT", "8787"))
BIND = os.environ.get("RELAY_BIND", "127.0.0.1")
SECRET = os.environ.get("RELAY_SECRET", "")

# How long the Jam-start UI driver gets to finish before we give up and
# return a structured error to the bot. Spotify can be sluggish on first
# Connect-flyout open so 30s is on the lower edge of "comfortable".
JAM_START_TIMEOUT_SEC = 30

# Path to the platform-specific UI driver. Always resolves next to this
# script so a `cd` doesn't break it.
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
JAM_DRIVER_PATH = os.path.join(_THIS_DIR, "jam_start_windows.py")

# Serialise UI-driver runs: two simultaneous Slack `start a jam` triggers
# would race the Spotify window. The lock is held only while the driver
# subprocess runs, so token-serving endpoints stay responsive.
_jam_driver_lock = threading.Lock()

if not SECRET:
    print(
        "[relay] FATAL: RELAY_SECRET is not set. Generate one with:\n"
        '        python -c "import secrets; print(secrets.token_hex(32))"\n'
        "        Then set it here AND set the same value as "
        "SPOTIFY_TOKEN_RELAY_SECRET on the droplet AND in the Chrome "
        "extension's options page.",
        file=sys.stderr,
    )
    sys.exit(1)


# In-process token cache. The Chrome extension pushes fresh tokens
# whenever Spotify's web player rotates them (~every 30-60 minutes).
# We track first-seen-at per unique token value and enforce a hard
# lifetime cap so a stale token cannot be perpetually renewed by a
# misbehaving (or buggy) extension that re-pushes the same value.
TOKEN_HARD_LIFETIME_MS = 55 * 60_000  # Spotify web tokens last ~1h.
_cached_token: Optional[str] = None
_cached_token_first_seen_ms: int = 0
_cached_expires_at_ms: int = 0


def _check_auth(header_value: str) -> bool:
    """Constant-time compare of the bearer header against RELAY_SECRET."""
    expected = f"Bearer {SECRET}"
    return hmac.compare_digest(header_value, expected)


class RelayHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args) -> None:  # noqa: A002
        return

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        # CORS: the Chrome extension calls us from a different origin.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header(
            "Access-Control-Allow-Headers", "Authorization, Content-Type"
        )
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send_json(204, {})

    def do_GET(self) -> None:  # noqa: N802
        global _cached_token, _cached_expires_at_ms

        if self.path == "/health":
            now_ms = int(time.time() * 1000)
            ttl_s = max(0, (_cached_expires_at_ms - now_ms) // 1000)
            self._send_json(
                200,
                {
                    "ok": True,
                    "hasToken": bool(_cached_token)
                    and now_ms < _cached_expires_at_ms,
                    "expiresInSec": ttl_s,
                },
            )
            return

        if self.path != "/token":
            self._send_json(404, {"error": "not found"})
            return

        auth = self.headers.get("Authorization", "")
        if not _check_auth(auth):
            self._send_json(401, {"error": "bad or missing bearer token"})
            print(f"[relay] 401 GET /token from {self.client_address[0]}")
            return

        now_ms = int(time.time() * 1000)
        if not _cached_token or now_ms >= _cached_expires_at_ms:
            self._send_json(
                503,
                {
                    "error": "no fresh token available — make sure Chrome "
                    "with the Jam Token Relay extension and a Spotify "
                    "Web Player tab are open on the host machine."
                },
            )
            print("[relay] 503 GET /token (no fresh token cached)")
            return

        ttl_s = max(0, (_cached_expires_at_ms - now_ms) // 1000)
        self._send_json(
            200,
            {
                "accessToken": _cached_token,
                "accessTokenExpirationTimestampMs": _cached_expires_at_ms,
                "isAnonymous": False,
                "fromCache": True,
            },
        )
        print(f"[relay] served token (expires in {ttl_s}s)")

    def do_POST(self) -> None:  # noqa: N802
        global _cached_token, _cached_token_first_seen_ms, _cached_expires_at_ms

        if self.path == "/jam/start":
            self._handle_jam_start()
            return

        if self.path != "/admin/set-token":
            self._send_json(404, {"error": "not found"})
            return

        auth = self.headers.get("Authorization", "")
        if not _check_auth(auth):
            self._send_json(401, {"error": "bad or missing bearer token"})
            print(
                f"[relay] 401 POST /admin/set-token from "
                f"{self.client_address[0]}"
            )
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send_json(400, {"error": "bad Content-Length"})
            return
        if length <= 0 or length > 64_000:
            self._send_json(400, {"error": "missing or oversized body"})
            return

        try:
            raw = self.rfile.read(length)
            data = json.loads(raw)
        except (json.JSONDecodeError, ValueError) as e:
            self._send_json(400, {"error": f"invalid JSON: {e}"})
            return

        token = data.get("accessToken")
        if not isinstance(token, str) or not token:
            self._send_json(400, {"error": "missing accessToken (string)"})
            return

        now_ms = int(time.time() * 1000)

        # Enforce a hard lifetime per UNIQUE token value: re-pushing the
        # same token does not extend its expiry. The extension is wired
        # to only push on a value change, but we defend in depth.
        if token == _cached_token and _cached_token_first_seen_ms > 0:
            first_seen = _cached_token_first_seen_ms
            still_valid = now_ms < _cached_expires_at_ms
            ttl_s = max(0, (_cached_expires_at_ms - now_ms) // 1000)
            self._send_json(
                200,
                {
                    "ok": True,
                    "expiresInSec": ttl_s,
                    "unchanged": True,
                    "stillValid": still_valid,
                },
            )
            age_s = (now_ms - first_seen) // 1000
            print(
                f"[relay] re-push of same token ignored "
                f"(age {age_s}s, ttl {ttl_s}s)"
            )
            return

        _cached_token = token
        _cached_token_first_seen_ms = now_ms
        _cached_expires_at_ms = now_ms + TOKEN_HARD_LIFETIME_MS

        ttl_s = TOKEN_HARD_LIFETIME_MS // 1000
        self._send_json(200, {"ok": True, "expiresInSec": ttl_s})
        print(
            f"[relay] accepted NEW token from extension "
            f"(hard ttl {ttl_s}s, len={len(token)})"
        )


def _handle_jam_start_impl(handler: "RelayHandler") -> None:
    auth = handler.headers.get("Authorization", "")
    if not _check_auth(auth):
        handler._send_json(401, {"error": "bad or missing bearer token"})
        print(
            f"[relay] 401 POST /jam/start from {handler.client_address[0]}"
        )
        return

    if not os.path.isfile(JAM_DRIVER_PATH):
        handler._send_json(
            503,
            {
                "ok": False,
                "reason": (
                    f"UI driver missing at {JAM_DRIVER_PATH}. Pull the "
                    f"latest tools/spotify-token-relay/ from the repo."
                ),
            },
        )
        return

    # Drain any request body so the connection stays clean.
    try:
        length = int(handler.headers.get("Content-Length", "0") or "0")
        if length > 0:
            handler.rfile.read(min(length, 64_000))
    except Exception:
        pass

    # Try to acquire the lock without blocking forever; if another
    # jam-start is in flight, tell the caller plainly.
    acquired = _jam_driver_lock.acquire(blocking=True, timeout=2.0)
    if not acquired:
        handler._send_json(
            200,
            {
                "ok": False,
                "reason": (
                    "another jam-start is already in flight on this host; "
                    "try again in a few seconds."
                ),
            },
        )
        return

    started = time.time()
    try:
        print(f"[relay] /jam/start: spawning {JAM_DRIVER_PATH}")
        proc = subprocess.run(
            [sys.executable, JAM_DRIVER_PATH],
            capture_output=True,
            text=True,
            timeout=JAM_START_TIMEOUT_SEC,
            # Inherit OPENROUTER_API_KEY etc. from the relay's env.
        )
    except subprocess.TimeoutExpired:
        elapsed = int(time.time() - started)
        handler._send_json(
            504,
            {
                "ok": False,
                "reason": (
                    f"UI driver timed out after {elapsed}s — Spotify is "
                    f"likely unresponsive, locked behind a modal, or in a "
                    f"weird state. Bring the Spotify window to the front "
                    f"manually and retry."
                ),
            },
        )
        print(f"[relay] /jam/start TIMEOUT after {elapsed}s")
        return
    except Exception as e:
        handler._send_json(
            500,
            {"ok": False, "reason": f"failed to spawn UI driver: {e}"},
        )
        return
    finally:
        _jam_driver_lock.release()

    elapsed = int(time.time() - started)
    stderr_tail_lines = (proc.stderr or "").strip().splitlines()[-12:]
    for line in stderr_tail_lines:
        print(f"[driver] {line}")
    stderr_tail = "\n".join(stderr_tail_lines)[-600:]

    stdout = (proc.stdout or "").strip()
    last_line = stdout.splitlines()[-1] if stdout else ""

    # If the driver crashed (non-zero exit) or never wrote any JSON,
    # surface a 502 with a specific reason rather than letting the bot
    # see an unhelpful "ok:false with no reason".
    if not last_line:
        print(
            f"[relay] /jam/start driver produced no output "
            f"(rc={proc.returncode}, elapsed={elapsed}s)"
        )
        handler._send_json(
            502,
            {
                "ok": False,
                "reason": (
                    f"UI driver exited (code {proc.returncode}) without "
                    f"producing a JSON result. Likely it crashed before "
                    f"emit() ran; see stderrTail for the failure."
                ),
                "stderrTail": stderr_tail,
            },
        )
        return

    try:
        result = json.loads(last_line)
    except json.JSONDecodeError:
        handler._send_json(
            502,
            {
                "ok": False,
                "reason": (
                    "UI driver returned non-JSON output on its final stdout "
                    "line. See stderrTail for the driver log tail."
                ),
                "stdoutTail": stdout[-400:],
                "stderrTail": stderr_tail,
            },
        )
        return

    if not isinstance(result, dict) or "ok" not in result:
        handler._send_json(
            502,
            {
                "ok": False,
                "reason": (
                    "UI driver returned a JSON value missing the required "
                    "'ok' field — driver contract violated."
                ),
                "stdoutTail": stdout[-400:],
                "stderrTail": stderr_tail,
            },
        )
        return

    # If the driver exited non-zero but did write a structured result,
    # trust the result but annotate it so the bot's logs are clear.
    if proc.returncode != 0 and result.get("ok") is True:
        result = dict(result)
        result["ok"] = False
        result["reason"] = (
            f"driver claimed ok but exited rc={proc.returncode}; treating "
            f"as failure. Original payload: {json.dumps(result)[:200]}"
        )

    print(
        f"[relay] /jam/start finished in {elapsed}s -> "
        f"ok={result.get('ok')!r} (rc={proc.returncode})"
    )
    handler._send_json(200, result)


# Bind the implementation as a method so it can use self._send_json etc.
RelayHandler._handle_jam_start = lambda self: _handle_jam_start_impl(self)  # type: ignore[attr-defined]


def main() -> None:
    server = ThreadingHTTPServer((BIND, PORT), RelayHandler)
    driver_status = "found" if os.path.isfile(JAM_DRIVER_PATH) else "MISSING"
    print(
        f"[relay] listening on http://{BIND}:{PORT}\n"
        f"[relay] endpoints: POST /admin/set-token, GET /token, "
        f"POST /jam/start, GET /health\n"
        f"[relay] jam UI driver: {JAM_DRIVER_PATH} ({driver_status})\n"
        f"[relay] waiting for the Chrome extension to push the first token...\n"
        f"[relay] expose this to your droplet via cloudflared/ngrok"
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[relay] shutting down")
        server.server_close()


if __name__ == "__main__":
    main()
