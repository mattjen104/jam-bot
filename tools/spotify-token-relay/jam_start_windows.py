#!/usr/bin/env python3
"""
Jam Start Driver — Windows (multi-substrate)
============================================

Drives the Spotify Desktop client on Windows to start a Jam session and
returns the resulting join URL as JSON on stdout.

Invoked by the relay's POST /jam/start endpoint. Runnable directly for
debugging:

    python jam_start_windows.py
    python jam_start_windows.py --debug-tree
    python jam_start_windows.py --vision-only
    python jam_start_windows.py --no-cdp
    python jam_start_windows.py --no-uia
    python jam_start_windows.py --clear-cache

Always writes a single JSON object to stdout:
    {"ok": true,  "joinUrl": "https://open.spotify.com/jam/..."}
    {"ok": false, "reason": "<specific failure reason>"}

Exit code is always 0; consumers parse the JSON. Human-readable progress
logs go to stderr.

Architecture
------------

The driver is a tiny computer-use engine over Spotify Desktop. Three
substrates (DOM via Chrome DevTools Protocol, UI Automation, vision)
each implement the same `find / click` interface. The engine walks a
goal sequence, trying substrates in priority order. The first substrate
that satisfies a goal wins, clicks, and records its fingerprint of the
clicked element so future runs can fast-path through cache.

Goal sequence (in order):
  1. find_jam_button_directly           (already visible? rare but fast)
  2. open_friend_activity → find_jam    (preferred opener; sidebar route)
  3. open_connect_popover → find_jam    (fallback opener; popover route)

Substrate priority (in order):
  1. CDP   — Chrome DevTools Protocol. Real DOM access via
             aria-label, data-testid, role, visible text.
             Requires Spotify launched with --remote-debugging-port=9222.
  2. UIA   — Windows UI Automation tree. Slower, names are sparser.
             Always available on Windows.
  3. VISION — OpenRouter vision model. Last resort; ~1-3s + paid.

Multi-modal fingerprint cache:
  Keyed by (spotify_exe@mtime, goal_name). Each substrate writes its
  own fingerprint subkey on a successful end-to-end run. On future
  runs, every substrate can fast-path against its own key
  independently — one substrate's drift doesn't invalidate another's.

Required env vars when invoked by the relay:
    OPENROUTER_API_KEY   only required if vision substrate is needed
    OPENROUTER_MODEL_VISION   default "openai/gpt-4o-mini"
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Optional


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

# Stdout is reserved for the final JSON result. All progress goes to
# stderr so the calling relay can stream it without contaminating the
# response body.
def log(msg: str) -> None:
    print(f"[jam-driver] {msg}", file=sys.stderr, flush=True)


def log_step(substrate: str, goal: str, result: str, **kv) -> None:
    """Structured per-substrate-per-goal log. Makes Spotify drift
    diagnosable from the relay log alone (no --debug-tree needed)."""
    extras = " ".join(f"{k}={v!r}" for k, v in kv.items())
    log(f"step substrate={substrate} goal={goal} result={result} {extras}".rstrip())


def emit(payload: dict) -> None:
    """Write the single JSON result and exit cleanly."""
    json.dump(payload, sys.stdout)
    sys.stdout.write("\n")
    sys.stdout.flush()
    sys.exit(0)


# ---------------------------------------------------------------------------
# Goal vocabulary
# ---------------------------------------------------------------------------
# Each goal is identified by a stable name (used as the cache key) and a
# list of hint strings. Hints are matched case-insensitively as
# substrings against any text-like property a substrate exposes
# (aria-label, data-testid, visible text, UIA name, automation_id, etc).

GOAL_FIND_JAM = "find_jam_button"
GOAL_OPEN_FRIEND_ACTIVITY = "open_friend_activity"
GOAL_OPEN_CONNECT = "open_connect_popover"
GOAL_COPY_LINK = "copy_share_link"

JAM_HINTS = (
    "start a jam",
    "start jam",
    "start session",
    "start a session",
    "create a jam",
    "host a jam",
)

FRIEND_ACTIVITY_HINTS = (
    "friend activity",
    "what friends are playing",
    "what friends are listening",
    "buddy list",
    "friendactivitybutton",
    "show friends",
    "friends",  # last resort; restricted by control type
)

CONNECT_HINTS = (
    "connect to a device",
    "playing on ",  # button text changes when actively streaming
    "devices available",
    "spotify connect",
)

SHARE_LINK_HINTS = (
    "copy link",
    "copy invite link",
    "share link",
)

# Order matters — try direct first, then preferred opener, then fallback.
JAM_STRATEGIES: list[tuple[str, Optional[tuple[str, tuple[str, ...]]]]] = [
    # (description, opener) where opener is None for "no prior click"
    ("direct (Jam button already visible)", None),
    ("via Friend Activity sidebar", (GOAL_OPEN_FRIEND_ACTIVITY, FRIEND_ACTIVITY_HINTS)),
    ("via Connect popover", (GOAL_OPEN_CONNECT, CONNECT_HINTS)),
]

JAM_URL_RE = re.compile(
    r"https?://(?:open\.)?spotify\.com/(?:jam|social-session)/[A-Za-z0-9_\-]+"
)


def _extract_jam_url(text: str) -> Optional[str]:
    if not text:
        return None
    m = JAM_URL_RE.search(text)
    return m.group(0) if m else None


# ---------------------------------------------------------------------------
# Spotify version probe (cache invalidation key)
# ---------------------------------------------------------------------------

def _spotify_version() -> str:
    """
    Return a string identifying the running Spotify build. We use the
    process executable path + its mtime as a cheap proxy for "which
    Spotify version is this" — exact enough that an auto-update
    invalidates the cache without parsing Spotify's version metadata.
    """
    try:
        import psutil  # type: ignore

        for proc in psutil.process_iter(["name", "exe"]):
            try:
                name = (proc.info.get("name") or "").lower()
                exe = proc.info.get("exe") or ""
            except Exception:
                continue
            if name == "spotify.exe" and exe:
                try:
                    mtime = int(os.path.getmtime(exe))
                except OSError:
                    mtime = 0
                return f"{exe}@{mtime}"
    except Exception as e:
        log(f"spotify version probe failed: {e}")
    return "unknown"


# ---------------------------------------------------------------------------
# Multi-modal fingerprint cache
# ---------------------------------------------------------------------------
# Layout:
#   {
#     "<spotify_version>": {
#       "<goal_name>": {
#         "cdp":    {"selector": "...", "aria": "...", "saved_at": ...},
#         "uia":    {"name": "...", "auto_id": "...", "saved_at": ...},
#         "vision": {"x_pct": ..., "y_pct": ..., "saved_at": ...}
#       }
#     }
#   }
# Each substrate reads/writes only its own subkey, so one substrate's
# drift never invalidates another's fast path. Writes are append-merge:
# missing fields don't overwrite previously-captured ones.

_CACHE_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), ".jam_fingerprint_cache.json"
)


def _load_cache() -> dict:
    try:
        with open(_CACHE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def _save_cache(cache: dict) -> None:
    try:
        tmp = _CACHE_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cache, f, indent=2)
        os.replace(tmp, _CACHE_PATH)
    except OSError as e:
        log(f"cache write failed: {e}")


def _cache_get(version: str, goal: str, substrate: str) -> Optional[dict]:
    cache = _load_cache()
    return cache.get(version, {}).get(goal, {}).get(substrate)


def _cache_put(version: str, goal: str, substrate: str, fp: dict) -> None:
    """Append-merge: only writes the keys present in `fp`, preserves others."""
    cache = _load_cache()
    bucket = cache.setdefault(version, {}).setdefault(goal, {}).setdefault(substrate, {})
    bucket.update(fp)
    bucket["saved_at"] = int(time.time())
    _save_cache(cache)


# ---------------------------------------------------------------------------
# Substrate base
# ---------------------------------------------------------------------------

class Substrate:
    """Abstract substrate. Each backend (CDP, UIA, vision) implements
    these four methods. The engine treats substrates uniformly."""

    name: str = "?"

    def available(self) -> bool:
        """Cheap check — can this substrate operate right now?"""
        return False

    def try_cached(self, version: str, goal: str) -> bool:
        """Replay a cached fingerprint. Return True iff a click was issued."""
        return False

    def find_and_click(
        self, goal: str, hints: tuple[str, ...]
    ) -> tuple[bool, Optional[dict]]:
        """Find an element matching any hint, click it. Return
        (clicked, fingerprint). Fingerprint is the substrate-specific
        identifier dict to persist on end-to-end success."""
        return (False, None)

    def extract_url(self) -> Optional[str]:
        """After clicking the Jam button, look for the share URL via
        this substrate. Return the URL or None."""
        return None


# ---------------------------------------------------------------------------
# CDP substrate (Chrome DevTools Protocol via websocket)
# ---------------------------------------------------------------------------
# Spotify Desktop is Electron. Launched with --remote-debugging-port=9222
# it exposes a real Chromium DevTools endpoint, giving us direct DOM
# access (aria-label, data-testid, role, text). This is the most
# reliable substrate by a wide margin.

_CDP_PORT = int(os.environ.get("SPOTIFY_CDP_PORT", "9222"))
_CDP_HOST = "127.0.0.1"


def _http_get_json(url: str, timeout: float = 1.5) -> Optional[Any]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, json.JSONDecodeError, TimeoutError):
        return None


def _import_websocket():
    try:
        import websocket  # type: ignore
        return websocket
    except ImportError:
        return None


# In-page JS injected once per CDP connection. Exposes window helpers
# the click-and-find evaluations call into. Keeps the per-call payload
# small and the matching logic in one readable place.
_CDP_HELPER_JS = r"""
(() => {
  if (window.__jamHelperLoaded) return true;
  window.__jamHelperLoaded = true;

  // CSS-path-ish selector for an element. Used as a stable fingerprint
  // in the cache. We prefer data-testid > id > aria-label > class chain.
  window.__jamSelector = (el) => {
    if (!el) return null;
    const t = el.getAttribute && el.getAttribute('data-testid');
    if (t) return `[data-testid="${t}"]`;
    const a = el.getAttribute && el.getAttribute('aria-label');
    if (a) return `[aria-label="${a.replace(/"/g, '\\"')}"]`;
    if (el.id) return `#${el.id}`;
    // Walk up to first stable ancestor and emit a chain.
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && parts.length < 6) {
      let p = n.tagName.toLowerCase();
      const tid = n.getAttribute && n.getAttribute('data-testid');
      if (tid) { parts.unshift(`[data-testid="${tid}"]`); break; }
      const cls = (n.className && typeof n.className === 'string')
        ? n.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      if (cls) p += '.' + cls;
      parts.unshift(p);
      n = n.parentElement;
    }
    return parts.join(' > ');
  };

  // Walk shadow DOM too — Spotify uses some web components.
  window.__jamWalk = function* (root) {
    const stack = [root];
    while (stack.length) {
      const n = stack.pop();
      if (!n) continue;
      yield n;
      if (n.shadowRoot) stack.push(...n.shadowRoot.children);
      if (n.children) stack.push(...n.children);
    }
  };

  // Find the first interactive element matching any of `hints`. Search
  // aria-label, data-testid, title, alt, and trimmed innerText.
  window.__jamFind = (hints, opts) => {
    opts = opts || {};
    const lower = hints.map(h => String(h).toLowerCase());
    const candidates = [];
    for (const el of window.__jamWalk(document.documentElement)) {
      if (!el || !el.getAttribute) continue;
      const role = (el.getAttribute('role') || '').toLowerCase();
      const tag = (el.tagName || '').toLowerCase();
      const isClickable =
        tag === 'button' || tag === 'a' || role === 'button' || role === 'link' ||
        role === 'menuitem' || role === 'option' || role === 'tab' ||
        el.hasAttribute('onclick');
      if (!isClickable) continue;
      const haystack = (
        (el.getAttribute('aria-label') || '') + ' ' +
        (el.getAttribute('data-testid') || '') + ' ' +
        (el.getAttribute('title') || '') + ' ' +
        (el.getAttribute('alt') || '') + ' ' +
        (el.innerText || '').slice(0, 200)
      ).toLowerCase();
      if (!haystack.trim()) continue;
      for (const h of lower) {
        if (h && haystack.includes(h)) {
          candidates.push({ el, hit: h });
          break;
        }
      }
    }
    if (!candidates.length) return null;
    // Prefer visible elements.
    const visible = candidates.find(c => {
      const r = c.el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }) || candidates[0];
    const el = visible.el;
    const r = el.getBoundingClientRect();
    return {
      selector: window.__jamSelector(el),
      aria: el.getAttribute('aria-label') || null,
      testid: el.getAttribute('data-testid') || null,
      role: el.getAttribute('role') || el.tagName.toLowerCase(),
      text: (el.innerText || '').trim().slice(0, 80),
      hit: visible.hit,
      bbox: { x: r.x, y: r.y, w: r.width, h: r.height },
    };
  };

  window.__jamClickBySelector = (selector) => {
    if (!selector) return false;
    let el = null;
    try { el = document.querySelector(selector); } catch (e) { return false; }
    if (!el) {
      // Fallback: walk shadow DOM for the same selector.
      for (const n of window.__jamWalk(document.documentElement)) {
        if (n && n.matches && n.matches(selector)) { el = n; break; }
      }
    }
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    // Synthesise a real mouse click sequence — some Spotify handlers
    // listen for pointerdown rather than click().
    const r = el.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0,
      }));
    }
    return true;
  };

  window.__jamFindUrl = () => {
    const re = /https?:\/\/(?:open\.)?spotify\.com\/(?:jam|social-session)\/[A-Za-z0-9_\-]+/;
    // Inputs / textareas first (Jam dialog renders the URL into one).
    for (const el of document.querySelectorAll('input, textarea')) {
      const v = el.value || '';
      const m = v.match(re);
      if (m) return m[0];
    }
    // Anchors.
    for (const a of document.querySelectorAll('a[href]')) {
      const m = (a.href || '').match(re);
      if (m) return m[0];
    }
    // Visible text.
    const m = (document.body.innerText || '').match(re);
    return m ? m[0] : null;
  };

  return true;
})()
"""


class CDPSubstrate(Substrate):
    name = "cdp"

    def __init__(self) -> None:
        self._ws = None
        self._msg_id = 0
        self._target_url: Optional[str] = None
        self._unavailable_reason: Optional[str] = None

    # --- low-level ----------------------------------------------------

    def _next_id(self) -> int:
        self._msg_id += 1
        return self._msg_id

    def _send(self, method: str, params: Optional[dict] = None) -> Optional[dict]:
        if self._ws is None:
            return None
        msg_id = self._next_id()
        payload = {"id": msg_id, "method": method, "params": params or {}}
        try:
            self._ws.send(json.dumps(payload))
        except Exception as e:
            log_step(self.name, "_send", "error", method=method, err=str(e))
            return None
        # Read until we see our id (CDP intersperses event messages).
        deadline = time.time() + 5.0
        while time.time() < deadline:
            try:
                raw = self._ws.recv()
            except Exception as e:
                log_step(self.name, "_send", "recv-error", method=method, err=str(e))
                return None
            try:
                obj = json.loads(raw)
            except Exception:
                continue
            if obj.get("id") == msg_id:
                return obj
        return None

    def _eval(self, expr: str, return_value: bool = True) -> Any:
        res = self._send(
            "Runtime.evaluate",
            {
                "expression": expr,
                "returnByValue": return_value,
                "awaitPromise": False,
            },
        )
        if not res:
            return None
        result = res.get("result", {}).get("result", {})
        if "value" in result:
            return result["value"]
        return None

    # --- discovery / lifecycle ---------------------------------------

    def _discover_target(self) -> Optional[dict]:
        url = f"http://{_CDP_HOST}:{_CDP_PORT}/json"
        targets = _http_get_json(url, timeout=1.5)
        if not isinstance(targets, list):
            self._unavailable_reason = (
                f"no CDP endpoint at {_CDP_HOST}:{_CDP_PORT} — "
                "is Spotify launched with --remote-debugging-port=9222?"
            )
            return None
        # Prefer the main app page (xpui) over service workers / others.
        page_targets = [
            t for t in targets
            if t.get("type") == "page" and t.get("webSocketDebuggerUrl")
        ]
        if not page_targets:
            self._unavailable_reason = (
                "CDP endpoint reachable but no Spotify page targets found."
            )
            return None
        # Heuristic: prefer URL with 'spotify' or 'xpui'; else pick first.
        for t in page_targets:
            u = (t.get("url") or "") + " " + (t.get("title") or "")
            if "spotify" in u.lower() or "xpui" in u.lower():
                return t
        return page_targets[0]

    def available(self) -> bool:
        if self._ws is not None:
            return True
        if self._unavailable_reason:
            return False
        websocket = _import_websocket()
        if websocket is None:
            self._unavailable_reason = (
                "websocket-client not installed (pip install websocket-client). "
                "Falling through to UIA."
            )
            log_step(self.name, "init", "skip", reason=self._unavailable_reason)
            return False
        target = self._discover_target()
        if not target:
            log_step(self.name, "init", "skip", reason=self._unavailable_reason)
            return False
        ws_url = target["webSocketDebuggerUrl"]
        try:
            self._ws = websocket.create_connection(ws_url, timeout=4.0)
        except Exception as e:
            self._unavailable_reason = f"CDP websocket connect failed: {e}"
            log_step(self.name, "init", "skip", reason=self._unavailable_reason)
            return False
        # Inject helper.
        ok = self._eval(_CDP_HELPER_JS)
        if not ok:
            self._unavailable_reason = "CDP helper injection failed"
            log_step(self.name, "init", "skip", reason=self._unavailable_reason)
            try:
                self._ws.close()
            except Exception:
                pass
            self._ws = None
            return False
        self._target_url = target.get("url")
        log_step(self.name, "init", "ok", target=self._target_url or "?")
        return True

    def close(self) -> None:
        if self._ws is not None:
            try:
                self._ws.close()
            except Exception:
                pass
            self._ws = None

    # --- substrate API -----------------------------------------------

    def try_cached(self, version: str, goal: str) -> bool:
        if not self.available():
            return False
        fp = _cache_get(version, goal, self.name)
        if not fp or not fp.get("selector"):
            return False
        sel = fp["selector"]
        expr = f"window.__jamClickBySelector({json.dumps(sel)})"
        ok = self._eval(expr)
        log_step(
            self.name, goal, "cache-hit" if ok else "cache-miss",
            selector=sel,
        )
        return bool(ok)

    def find_and_click(
        self, goal: str, hints: tuple[str, ...]
    ) -> tuple[bool, Optional[dict]]:
        if not self.available():
            return (False, None)
        # Find first.
        find_expr = f"window.__jamFind({json.dumps(list(hints))})"
        info = self._eval(find_expr)
        if not info or not isinstance(info, dict):
            log_step(self.name, goal, "miss", reason="no DOM match for hints")
            return (False, None)
        sel = info.get("selector")
        # Then click by selector (separate eval keeps selectors as the
        # canonical addressing scheme — same path the cache will use).
        click_expr = f"window.__jamClickBySelector({json.dumps(sel)})"
        ok = self._eval(click_expr)
        if not ok:
            log_step(self.name, goal, "click-failed", selector=sel)
            return (False, None)
        log_step(
            self.name, goal, "ok",
            selector=sel, aria=info.get("aria"), testid=info.get("testid"),
            hit=info.get("hit"),
        )
        fp = {
            "selector": sel,
            "aria": info.get("aria"),
            "testid": info.get("testid"),
        }
        return (True, fp)

    def extract_url(self) -> Optional[str]:
        if not self.available():
            return None
        url = self._eval("window.__jamFindUrl()")
        if isinstance(url, str) and url:
            log_step(self.name, GOAL_COPY_LINK, "url-extracted", url=url)
            return url
        return None


# ---------------------------------------------------------------------------
# UIA substrate
# ---------------------------------------------------------------------------

# Control types worth searching for clickable affordances. Spotify's
# Electron client exposes some buttons as ListItem / MenuItem / TabItem
# rather than Button.
_CLICKABLE_CTRL_TYPES = ("Button", "ListItem", "MenuItem", "TabItem", "Hyperlink")


def _import_pywinauto():
    try:
        from pywinauto import Application, Desktop  # type: ignore
        from pywinauto.findwindows import ElementNotFoundError  # type: ignore
        return Application, Desktop, ElementNotFoundError
    except ImportError as e:
        emit({
            "ok": False,
            "reason": (
                "pywinauto is not installed. On the host PC run "
                "`pip install pywinauto pyautogui mss Pillow requests "
                "psutil websocket-client`."
            ),
            "detail": str(e),
        })


def _import_pyautogui():
    try:
        import pyautogui  # type: ignore
        pyautogui.FAILSAFE = False
        return pyautogui
    except ImportError as e:
        emit({
            "ok": False,
            "reason": "pyautogui is not installed (see install hint above).",
            "detail": str(e),
        })


def _window_area(w) -> int:
    try:
        r = w.rectangle()
        return max(0, (r.right - r.left)) * max(0, (r.bottom - r.top))
    except Exception:
        return 0


def _find_spotify_window():
    """Locate the main Spotify desktop window. Returns (Application, window)."""
    Application, Desktop, _ = _import_pywinauto()
    title_re = re.compile(r".*", re.IGNORECASE)
    candidates = []
    try:
        for w in Desktop(backend="uia").windows(title_re=title_re):
            try:
                proc_name = ""
                try:
                    import psutil  # type: ignore
                    proc_name = psutil.Process(w.process_id()).name().lower()
                except Exception:
                    pass
                if "spotify" in proc_name or "spotify" in (w.window_text() or "").lower():
                    candidates.append(w)
            except Exception:
                continue
    except Exception as e:
        log(f"desktop enumeration failed: {e}")
    if not candidates:
        return None, None
    win = max(candidates, key=lambda w: _window_area(w))
    try:
        app = Application(backend="uia").connect(process=win.process_id())
        return app, win
    except Exception as e:
        log(f"connect-to-process failed: {e}")
        return None, win


def _all_descendants(win, control_type: Optional[str] = None):
    try:
        return win.descendants(control_type=control_type) if control_type else win.descendants()
    except Exception as e:
        log(f"descendants() failed: {e}")
        return []


def _enumerate_uia(win) -> list[dict]:
    out: list[dict] = []
    for el in _all_descendants(win, None):
        try:
            ctrl = el.element_info.control_type or ""
        except Exception:
            ctrl = ""
        try:
            name = (el.window_text() or "").strip()
        except Exception:
            name = ""
        try:
            auto_id = getattr(el.element_info, "automation_id", "") or ""
        except Exception:
            auto_id = ""
        out.append({"el": el, "name": name, "auto_id": auto_id, "ctrl": ctrl})
    return out


def _match_uia(elements: list[dict], hints, ctrl_types=_CLICKABLE_CTRL_TYPES):
    """Match by hint substring, but prefer narrower control types first.

    Spotify's Electron UI often nests a real <Button name="Start a Jam">
    inside a <ListItem name="Invite others to your Jam, and listen
    together from anywhere.Start a Jam">. Both match the hint
    "start a jam", but only clicking the Button actually invokes the
    action; clicking the ListItem container is a no-op. So we walk
    ctrl_types in the order they were given (Button first by convention
    in _CLICKABLE_CTRL_TYPES) and only fall back to wider container
    types if no narrower match exists.
    """
    hints_lower = [h.lower() for h in hints if h]
    if not hints_lower:
        return None
    types_in_order = ctrl_types if ctrl_types else (None,)
    for want_ctrl in types_in_order:
        for e in elements:
            if want_ctrl is not None and e["ctrl"] != want_ctrl:
                continue
            haystack = (e["name"] + " " + e["auto_id"]).lower()
            if not haystack.strip():
                continue
            for h in hints_lower:
                if h in haystack:
                    return e
    return None


def _click_uia(el, prefer_real_mouse: bool = True) -> bool:
    """Spotify's Connect popover only opens on a real mouse click, not
    on UIA invoke(). Default to click_input for that reason."""
    if prefer_real_mouse:
        order = ("click_input", "invoke", "click")
    else:
        order = ("invoke", "click_input", "click")
    for fn_name in order:
        try:
            fn = getattr(el, fn_name, None)
            if fn is None:
                continue
            fn()
            return True
        except Exception as e:
            log(f"uia {fn_name}() raised: {e}")
            continue
    return False


class UIASubstrate(Substrate):
    name = "uia"

    def __init__(self) -> None:
        self._win = None
        self._win_checked = False
        self._unavailable_reason: Optional[str] = None

    def _ensure_window(self):
        if self._win is not None or self._win_checked:
            return self._win
        self._win_checked = True
        if sys.platform != "win32":
            self._unavailable_reason = "not on Windows"
            return None
        _, win = _find_spotify_window()
        if win is None:
            self._unavailable_reason = "Spotify window not found"
            log_step(self.name, "init", "skip", reason=self._unavailable_reason)
            return None
        try:
            win.set_focus()
        except Exception:
            pass
        self._win = win
        log_step(self.name, "init", "ok")
        return self._win

    def available(self) -> bool:
        return self._ensure_window() is not None

    def try_cached(self, version: str, goal: str) -> bool:
        win = self._ensure_window()
        if win is None:
            return False
        fp = _cache_get(version, goal, self.name)
        if not fp:
            return False
        elements = _enumerate_uia(win)
        # Try exact name+auto_id match first; fall back to either alone.
        target = None
        want_name = (fp.get("name") or "").lower()
        want_auto = (fp.get("auto_id") or "").lower()
        for e in elements:
            if e["ctrl"] not in _CLICKABLE_CTRL_TYPES:
                continue
            n = e["name"].lower()
            a = e["auto_id"].lower()
            if want_auto and a == want_auto:
                target = e
                break
            if want_name and n == want_name:
                target = e
                break
        if target is None:
            log_step(self.name, goal, "cache-miss",
                     name=fp.get("name"), auto_id=fp.get("auto_id"))
            return False
        ok = _click_uia(target["el"])
        log_step(self.name, goal, "cache-hit" if ok else "cache-miss",
                 name=target["name"], auto_id=target["auto_id"])
        return ok

    def find_and_click(
        self, goal: str, hints: tuple[str, ...]
    ) -> tuple[bool, Optional[dict]]:
        win = self._ensure_window()
        if win is None:
            return (False, None)
        elements = _enumerate_uia(win)
        match = _match_uia(elements, hints)
        if match is None:
            log_step(self.name, goal, "miss",
                     reason=f"no UIA element matched any of {len(hints)} hints",
                     candidates=len(elements))
            return (False, None)
        ok = _click_uia(match["el"])
        if not ok:
            log_step(self.name, goal, "click-failed",
                     name=match["name"], auto_id=match["auto_id"])
            return (False, None)
        log_step(self.name, goal, "ok",
                 name=match["name"], auto_id=match["auto_id"], ctrl=match["ctrl"])
        fp = {"name": match["name"], "auto_id": match["auto_id"], "ctrl": match["ctrl"]}
        return (True, fp)

    def extract_url(self) -> Optional[str]:
        win = self._ensure_window()
        if win is None:
            return None
        candidates = (
            _all_descendants(win, "Edit")
            + _all_descendants(win, "Document")
            + _all_descendants(win, "Hyperlink")
            + _all_descendants(win, "Text")
        )
        for el in candidates:
            try:
                txt = el.window_text() or ""
            except Exception:
                continue
            url = _extract_jam_url(txt)
            if url:
                log_step(self.name, GOAL_COPY_LINK, "url-extracted", url=url)
                return url
        return None

    def click_copy_link_and_read_clipboard(self) -> Optional[str]:
        win = self._ensure_window()
        if win is None:
            log_step(self.name, GOAL_COPY_LINK, "skip",
                     reason="no spotify window")
            return None
        elements = _enumerate_uia(win)
        match = _match_uia(elements, SHARE_LINK_HINTS)
        if match is None:
            log_step(self.name, GOAL_COPY_LINK, "no-copy-link-button",
                     candidates=len(elements),
                     hints=list(SHARE_LINK_HINTS))
            return None
        # Capture element coords so if we end up clicking the wrong thing
        # we can spot it.
        try:
            r = match["el"].rectangle()
            bbox = (r.left, r.top, r.right, r.bottom)
        except Exception:
            bbox = None
        log_step(self.name, GOAL_COPY_LINK, "found-copy-link",
                 name=match["name"], ctrl=match["ctrl"], bbox=bbox)
        click_ok = _click_uia(match["el"])
        log_step(self.name, GOAL_COPY_LINK, "click-attempted",
                 click_ok=click_ok)
        if not click_ok:
            log_step(self.name, GOAL_COPY_LINK, "copy-link-click-failed",
                     name=match["name"])
            return None
        # Spotify needs a beat for the clipboard write to land.
        time.sleep(0.7)
        log_step(self.name, GOAL_COPY_LINK, "clipboard-read-begin")
        text = ""
        try:
            import ctypes
            from ctypes import wintypes
            CF_UNICODETEXT = 13
            user32 = ctypes.windll.user32
            kernel32 = ctypes.windll.kernel32
            # CRITICAL on 64-bit Python: declare restypes as pointer-sized
            # (c_void_p), otherwise ctypes truncates HANDLE/HGLOBAL to
            # 32 bits and GlobalLock gets a garbage pointer.
            user32.OpenClipboard.argtypes = [wintypes.HWND]
            user32.OpenClipboard.restype = wintypes.BOOL
            user32.GetClipboardData.argtypes = [wintypes.UINT]
            user32.GetClipboardData.restype = ctypes.c_void_p
            user32.CloseClipboard.argtypes = []
            user32.CloseClipboard.restype = wintypes.BOOL
            kernel32.GlobalLock.argtypes = [ctypes.c_void_p]
            kernel32.GlobalLock.restype = ctypes.c_void_p
            kernel32.GlobalUnlock.argtypes = [ctypes.c_void_p]
            kernel32.GlobalUnlock.restype = wintypes.BOOL
            opened = user32.OpenClipboard(None)
            log_step(self.name, GOAL_COPY_LINK, "openclipboard",
                     ok=bool(opened))
            try:
                handle = user32.GetClipboardData(CF_UNICODETEXT)
                log_step(self.name, GOAL_COPY_LINK, "getclipboarddata",
                         handle=int(handle) if handle else 0)
                if not handle:
                    log_step(self.name, GOAL_COPY_LINK,
                             "clipboard-empty-after-click")
                    return None
                ptr = kernel32.GlobalLock(handle)
                try:
                    if not ptr:
                        log_step(self.name, GOAL_COPY_LINK,
                                 "globallock-null")
                        return None
                    text = ctypes.wstring_at(ptr)
                    log_step(self.name, GOAL_COPY_LINK,
                             "clipboard-read-ok", chars=len(text or ""))
                finally:
                    kernel32.GlobalUnlock(handle)
            finally:
                user32.CloseClipboard()
        except Exception as e:
            log_step(self.name, GOAL_COPY_LINK, "clipboard-read-failed",
                     error=str(e))
            return None
        url = _extract_jam_url(text)
        if url:
            log_step(self.name, GOAL_COPY_LINK, "url-from-clipboard", url=url)
            return url
        # Surface what was actually copied so we can fix the regex if Spotify
        # changed its URL format. Truncate to avoid leaking long share text.
        preview = (text or "")[:200].replace("\n", "\\n")
        log_step(self.name, GOAL_COPY_LINK, "clipboard-no-jam-url-match",
                 clipboard_preview=preview, clipboard_len=len(text or ""))
        return None


# ---------------------------------------------------------------------------
# Vision substrate
# ---------------------------------------------------------------------------

def _grab_spotify_screenshot():
    """Returns (PIL.Image, (left, top, width, height)) of Spotify window."""
    _, win = _find_spotify_window()
    if win is None:
        return None, None
    try:
        r = win.rectangle()
    except Exception as e:
        log(f"window rectangle() failed: {e}")
        return None, None
    bbox = (r.left, r.top, max(1, r.right - r.left), max(1, r.bottom - r.top))
    try:
        import mss  # type: ignore
        from PIL import Image  # type: ignore
        with mss.mss() as sct:
            shot = sct.grab(
                {"left": r.left, "top": r.top, "width": bbox[2], "height": bbox[3]}
            )
            img = Image.frombytes("RGB", shot.size, shot.rgb)
            return img, bbox
    except Exception as e:
        log(f"screenshot via mss failed: {e}")
        return None, None


def _click_at_window_pct(bbox: tuple[int, int, int, int], pct: tuple[float, float]) -> None:
    pyautogui = _import_pyautogui()
    left, top, w, h = bbox
    ax = int(left + (pct[0] / 100.0) * w)
    ay = int(top + (pct[1] / 100.0) * h)
    pyautogui.moveTo(ax, ay, duration=0.15)
    pyautogui.click()


def _ask_vision_for_button(image, button_label: str) -> Optional[tuple[float, float]]:
    api_key = os.environ.get("OPENROUTER_API_KEY", "")
    if not api_key:
        log_step("vision", "_ask", "skip", reason="OPENROUTER_API_KEY not set")
        return None
    model = os.environ.get("OPENROUTER_MODEL_VISION", "openai/gpt-4o-mini")
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    prompt = (
        f"This is a screenshot of the Spotify desktop client window. "
        f"Find the '{button_label}' button. Reply with ONLY a JSON "
        f"object of the form {{\"x_pct\": <0-100>, \"y_pct\": <0-100>}} "
        f"giving the CENTER of the button as percentages of image width "
        f"and height. If you cannot find it with high confidence, reply "
        f"with {{\"x_pct\": null, \"y_pct\": null}}."
    )
    try:
        import requests  # type: ignore
        res = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "X-Title": "jam-bot ui-driver",
            },
            json={
                "model": model,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url",
                         "image_url": {"url": f"data:image/png;base64,{b64}"}},
                    ],
                }],
                "max_tokens": 80,
            },
            timeout=20,
        )
        res.raise_for_status()
        msg = res.json()["choices"][0]["message"]["content"]
    except Exception as e:
        log_step("vision", "_ask", "request-error", err=str(e))
        return None
    m = re.search(r"\{[^{}]*\}", msg)
    if not m:
        log_step("vision", "_ask", "non-json", body=msg[:120])
        return None
    try:
        coords = json.loads(m.group(0))
    except Exception:
        return None
    x = coords.get("x_pct")
    y = coords.get("y_pct")
    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return None
    return (float(x), float(y))


# Map abstract goal -> human label the vision model understands.
_VISION_LABELS = {
    GOAL_FIND_JAM: "Start a Jam",
    GOAL_OPEN_FRIEND_ACTIVITY: "Friend Activity icon (three heads, top right of window)",
    GOAL_OPEN_CONNECT: "Connect to a device (speaker icon at bottom-right of player)",
}


class VisionSubstrate(Substrate):
    name = "vision"

    def available(self) -> bool:
        return bool(os.environ.get("OPENROUTER_API_KEY", ""))

    def try_cached(self, version: str, goal: str) -> bool:
        if not self.available():
            return False
        fp = _cache_get(version, goal, self.name)
        if not fp:
            return False
        x = fp.get("x_pct")
        y = fp.get("y_pct")
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            return False
        _, bbox = _grab_spotify_screenshot()
        if bbox is None:
            return False
        _click_at_window_pct(bbox, (x, y))
        log_step(self.name, goal, "cache-hit", x_pct=x, y_pct=y)
        return True

    def find_and_click(
        self, goal: str, hints: tuple[str, ...]
    ) -> tuple[bool, Optional[dict]]:
        if not self.available():
            log_step(self.name, goal, "skip", reason="no API key")
            return (False, None)
        label = _VISION_LABELS.get(goal, hints[0] if hints else goal)
        img, bbox = _grab_spotify_screenshot()
        if img is None or bbox is None:
            log_step(self.name, goal, "miss", reason="no Spotify window for screenshot")
            return (False, None)
        coords = _ask_vision_for_button(img, label)
        if coords is None:
            log_step(self.name, goal, "miss", reason="model returned null/no match",
                     label=label)
            return (False, None)
        _click_at_window_pct(bbox, coords)
        log_step(self.name, goal, "ok", x_pct=coords[0], y_pct=coords[1], label=label)
        return (True, {"x_pct": coords[0], "y_pct": coords[1]})

    def extract_url(self) -> Optional[str]:
        # Vision can't reliably read URLs from the dialog; defer to UIA.
        return None


# ---------------------------------------------------------------------------
# Engine: goal-directed multi-substrate loop
# ---------------------------------------------------------------------------

class Engine:
    def __init__(self, substrates: list[Substrate]) -> None:
        self.substrates = substrates
        self.version = _spotify_version()
        # On end-to-end success, we persist this list of (goal, substrate, fp).
        self.pending_writes: list[tuple[str, str, dict]] = []

    def _try_goal(self, goal: str, hints: tuple[str, ...]) -> bool:
        """Run one goal across the substrate chain in priority order.
        For each substrate, try its cache fast path first, then a live
        find_and_click. First substrate that clicks anything wins —
        ensuring a higher-priority substrate's live attempt is never
        preempted by a lower-priority substrate's cache hit. Returns
        True iff SOME substrate clicked something."""
        for s in self.substrates:
            if not s.available():
                log_step(s.name, goal, "skip", reason="substrate unavailable")
                continue
            if s.try_cached(self.version, goal):
                return True
            ok, fp = s.find_and_click(goal, hints)
            if ok and fp is not None:
                # Stage the write — only commit after end-to-end success.
                self.pending_writes.append((goal, s.name, fp))
                return True
        return False

    def run_jam_flow(self) -> Optional[str]:
        # Try each strategy in order. Each strategy may run an opener
        # first, then the find-jam goal.
        for desc, opener in JAM_STRATEGIES:
            log(f"strategy: {desc}")
            if opener is not None:
                opener_goal, opener_hints = opener
                if not self._try_goal(opener_goal, opener_hints):
                    log_step("engine", opener_goal, "all-substrates-missed")
                    continue
                # Wait for popover/sidebar to render.
                time.sleep(1.4)
            if self._try_goal(GOAL_FIND_JAM, JAM_HINTS):
                # The click fired. The Jam share dialog usually appears
                # within ~1-3s but can be slow on cold cache. Poll
                # extract_url generously before giving up — falling
                # through to the next strategy here is *destructive*
                # because the FA opener is a toggle and will close the
                # already-open sidebar.
                deadline = time.time() + 18.0
                attempt = 0
                while time.time() < deadline:
                    url = self._extract_url_any()
                    if url:
                        self._commit_pending()
                        return url
                    attempt += 1
                    log_step("engine", "extract_url", "no-url-yet",
                             attempt=attempt)
                    time.sleep(1.0)
                # Genuine failure: clicked but no URL ever materialised.
                log_step("engine", "extract_url",
                         "give-up-after-successful-click",
                         strategy=desc, attempts=attempt)
                # Don't fall through to the next strategy — its opener
                # would untoggle the state we just set up. Bail out.
                return None
            else:
                log_step("engine", GOAL_FIND_JAM, "all-substrates-missed",
                         strategy=desc)
            # This strategy failed; clear its pending writes so we don't
            # cache an opener that didn't lead to success.
            self.pending_writes.clear()
        return None

    def _extract_url_any(self) -> Optional[str]:
        # Try every substrate's URL extractor; CDP first, then UIA dialog,
        # then UIA copy-link + clipboard.
        for s in self.substrates:
            if not s.available():
                continue
            url = s.extract_url()
            if url:
                return url
        # Last-ditch: explicit "copy link" via UIA + clipboard.
        for s in self.substrates:
            if isinstance(s, UIASubstrate) and s.available():
                url = s.click_copy_link_and_read_clipboard()
                if url:
                    return url
        return None

    def _commit_pending(self) -> None:
        for goal, substrate, fp in self.pending_writes:
            _cache_put(self.version, goal, substrate, fp)
        if self.pending_writes:
            log(f"committed {len(self.pending_writes)} fingerprints to cache")
        self.pending_writes.clear()

    def close(self) -> None:
        for s in self.substrates:
            close = getattr(s, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:
                    pass


# ---------------------------------------------------------------------------
# Debug helpers
# ---------------------------------------------------------------------------

def dump_tree() -> None:
    _, win = _find_spotify_window()
    if win is None:
        emit({"ok": False, "reason": "Spotify window not found for tree dump"})
    log(f"Spotify window: title={win.window_text()!r} class={win.class_name()!r}")

    def walk(el, depth=0):
        try:
            name = el.window_text()
            ctrl = el.element_info.control_type
            cls = el.class_name()
            log(f"{'  ' * depth}- {ctrl} name={name!r} class={cls!r}")
        except Exception as e:
            log(f"{'  ' * depth}- <walk error: {e}>")
            return
        try:
            for child in el.children():
                walk(child, depth + 1)
        except Exception:
            return

    walk(win)
    emit({"ok": True, "joinUrl": "<dump complete — re-run without --debug-tree>"})


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run(args) -> None:
    if sys.platform != "win32":
        emit({
            "ok": False,
            "reason": (
                "jam_start_windows.py requires Windows. For the future "
                "Linux port, see HOST_SETUP_WINDOWS.md."
            ),
        })

    # Strict flag semantics: each --no-* flag removes that substrate
    # entirely (clicks AND URL extraction). --vision-only is equivalent
    # to passing both --no-cdp and --no-uia.
    use_cdp = not args.no_cdp and not args.vision_only
    use_uia = not args.no_uia and not args.vision_only
    substrates: list[Substrate] = []
    if use_cdp:
        substrates.append(CDPSubstrate())
    if use_uia:
        substrates.append(UIASubstrate())
    substrates.append(VisionSubstrate())

    engine = Engine(substrates)
    try:
        url = engine.run_jam_flow()
    except Exception as e:
        log(f"engine raised: {e!r}")
        url = None
    finally:
        engine.close()

    if url is None:
        emit({
            "ok": False,
            "reason": (
                "Could not start a Jam. All substrates missed every "
                "strategy. Check that Spotify Desktop is running and "
                "signed in, that nothing is blocking it, and that "
                "something is currently playing. See the per-substrate "
                "step lines above for what each backend tried."
            ),
        })
    emit({"ok": True, "joinUrl": url})


def main() -> None:
    parser = argparse.ArgumentParser(description="Drive Spotify Desktop to start a Jam.")
    parser.add_argument("--debug-tree", action="store_true",
                        help="Print Spotify's UIA tree to stderr and exit.")
    parser.add_argument("--vision-only", action="store_true",
                        help="Use only the vision substrate for clicks.")
    parser.add_argument("--no-cdp", action="store_true",
                        help="Disable the CDP (DOM) substrate.")
    parser.add_argument("--no-uia", action="store_true",
                        help="Disable the UIA substrate entirely (clicks AND URL extraction).")
    parser.add_argument("--clear-cache", action="store_true",
                        help="Delete the fingerprint cache and exit.")
    args = parser.parse_args()

    if args.clear_cache:
        try:
            os.remove(_CACHE_PATH)
            log(f"cleared cache: {_CACHE_PATH}")
        except FileNotFoundError:
            log("cache already empty")
        except OSError as e:
            log(f"could not delete cache: {e}")
        emit({"ok": True, "joinUrl": "<cache cleared>"})

    if args.debug_tree:
        dump_tree()
    else:
        run(args)


if __name__ == "__main__":
    main()
