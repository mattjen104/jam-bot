#!/usr/bin/env python3
"""
Jam Start Driver — Windows
==========================

Drives the Spotify Desktop client on Windows to start a Jam session and
returns the resulting join URL as JSON on stdout.

Invoked by the relay's POST /jam/start endpoint. It is also runnable
directly for debugging:

    python jam_start_windows.py
    python jam_start_windows.py --debug-tree   # dump the UIA control tree
    python jam_start_windows.py --vision-only  # skip UIA, force vision

Always writes a single JSON object to stdout:
    {"ok": true,  "joinUrl": "https://open.spotify.com/jam/..."}
    {"ok": false, "reason": "<specific failure reason>"}

Exit code is always 0; consumers parse the JSON. Human-readable progress
logs go to stderr.

Strategy:
  1. UIA primary path. Use pywinauto (backend="uia") to find Spotify's
     window, walk to the Connect/devices button, click it, find
     "Start a Jam" (or "Start a session"), click it, then read the
     share URL out of the resulting dialog.
  2. Vision fallback. When UIA can't find a control by name (Spotify's
     control tree is sparse — many buttons are labelled only by index),
     screenshot the Spotify window, hand it to an OpenRouter vision
     model, ask "where is the X button?", and click at returned
     percentage coords. Slower (~3-6s per click) but resilient.
  3. URL extraction. Prefer reading the labelled share-URL textbox
     via UIA. Fall back to clicking the in-app "Copy link" button and
     reading the system clipboard.

Required env vars when invoked by the relay:
    OPENROUTER_API_KEY   only required if vision fallback is needed
    OPENROUTER_MODEL     default "openai/gpt-4o-mini" (vision-capable)
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
from typing import Optional

# Stdout is reserved for the final JSON result. All progress goes to
# stderr so the calling relay can stream it without contaminating the
# response body.
def log(msg: str) -> None:
    print(f"[jam-driver] {msg}", file=sys.stderr, flush=True)


def emit(payload: dict) -> None:
    """Write the single JSON result and exit cleanly."""
    json.dump(payload, sys.stdout)
    sys.stdout.write("\n")
    sys.stdout.flush()
    sys.exit(0)


# ---------------------------------------------------------------------------
# Imports that are heavy / Windows-only are deferred so the script can at
# least print a clean error on a non-Windows machine.
# ---------------------------------------------------------------------------

def _import_pywinauto():
    try:
        from pywinauto import Application, Desktop  # type: ignore
        from pywinauto.findwindows import ElementNotFoundError  # type: ignore

        return Application, Desktop, ElementNotFoundError
    except ImportError as e:
        emit(
            {
                "ok": False,
                "reason": (
                    "pywinauto is not installed. On the host PC run "
                    "`pip install pywinauto pyautogui mss Pillow requests`."
                ),
                "detail": str(e),
            }
        )


def _import_pyautogui():
    try:
        import pyautogui  # type: ignore

        pyautogui.FAILSAFE = False
        return pyautogui
    except ImportError as e:
        emit(
            {
                "ok": False,
                "reason": "pyautogui is not installed (see install hint above).",
                "detail": str(e),
            }
        )


def _import_pillow_clipboard():
    try:
        from PIL import ImageGrab  # type: ignore

        return ImageGrab
    except ImportError:
        return None


# ---------------------------------------------------------------------------
# UIA primary path
# ---------------------------------------------------------------------------

# Spotify renames the "Start a Jam" button between builds. Match against
# any of these (case-insensitive substring match on Name / FullDescription).
JAM_BUTTON_HINTS = (
    "start a jam",
    "start jam",
    "start session",
    "start a session",
    "create a jam",
)

CONNECT_BUTTON_HINTS = (
    "connect to a device",
    "connect",
    "devices available",
    "spotify connect",
)

SHARE_LINK_HINTS = (
    "copy link",
    "copy invite link",
    "share link",
)


def _find_spotify_window():
    """Locate the main Spotify desktop window. Returns (Application, window)."""
    Application, Desktop, ElementNotFoundError = _import_pywinauto()

    # Spotify's window title is usually "Spotify Free" / "Spotify Premium" /
    # the currently-playing "<Track> — <Artist>" / just "Spotify". We use a
    # regex against title and a class-name hint as a fallback.
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

    # Prefer the largest (main) window over notification popups.
    win = max(candidates, key=lambda w: _window_area(w))
    try:
        app = Application(backend="uia").connect(process=win.process_id())
        return app, win
    except Exception as e:
        log(f"connect-to-process failed: {e}")
        return None, win


def _window_area(w) -> int:
    try:
        r = w.rectangle()
        return max(0, (r.right - r.left)) * max(0, (r.bottom - r.top))
    except Exception:
        return 0


def _all_descendants(win, control_type: Optional[str] = None):
    try:
        return win.descendants(control_type=control_type) if control_type else win.descendants()
    except Exception as e:
        log(f"descendants() failed: {e}")
        return []


def _find_by_hint(win, hints, control_type: Optional[str] = "Button"):
    """Find the first descendant whose name matches any of the hints."""
    for el in _all_descendants(win, control_type):
        try:
            name = (el.window_text() or "").lower()
        except Exception:
            name = ""
        if not name:
            continue
        for hint in hints:
            if hint in name:
                return el
    return None


def _click(el) -> bool:
    """Try the most reliable invoke methods in order."""
    for fn_name in ("invoke", "click_input", "click"):
        try:
            fn = getattr(el, fn_name, None)
            if fn is None:
                continue
            fn()
            return True
        except Exception as e:
            log(f"{fn_name}() raised: {e}")
            continue
    return False


def _read_share_url_from_dialog(win) -> Optional[str]:
    """
    Try to find the join URL inside the Jam share dialog. Spotify renders
    it as either an Edit/Document control with the URL as text, or as a
    Hyperlink control. If we find nothing, return None and let the caller
    fall back to the clipboard.
    """
    candidate_controls = (
        _all_descendants(win, "Edit")
        + _all_descendants(win, "Document")
        + _all_descendants(win, "Hyperlink")
        + _all_descendants(win, "Text")
    )
    for el in candidate_controls:
        try:
            txt = el.window_text() or ""
        except Exception:
            continue
        url = _extract_jam_url(txt)
        if url:
            return url
    return None


JAM_URL_RE = re.compile(
    r"https?://(?:open\.)?spotify\.com/(?:jam|social-session)/[A-Za-z0-9_\-]+"
)


def _extract_jam_url(text: str) -> Optional[str]:
    if not text:
        return None
    m = JAM_URL_RE.search(text)
    return m.group(0) if m else None


def _click_copy_link_and_read_clipboard(win) -> Optional[str]:
    copy_btn = _find_by_hint(win, SHARE_LINK_HINTS)
    if not copy_btn:
        return None
    if not _click(copy_btn):
        return None
    time.sleep(0.5)
    ImageGrab = _import_pillow_clipboard()
    # Pillow's ImageGrab.grabclipboard returns text on Windows when text
    # is on the clipboard. Use a more reliable text-clipboard path:
    try:
        import ctypes
        import ctypes.wintypes as wintypes  # type: ignore

        CF_UNICODETEXT = 13
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32
        user32.OpenClipboard(0)
        try:
            handle = user32.GetClipboardData(CF_UNICODETEXT)
            if not handle:
                return None
            ptr = kernel32.GlobalLock(handle)
            try:
                if not ptr:
                    return None
                text = ctypes.wstring_at(ptr)
            finally:
                kernel32.GlobalUnlock(handle)
        finally:
            user32.CloseClipboard()
    except Exception as e:
        log(f"clipboard read failed: {e}")
        return None

    return _extract_jam_url(text)


def try_uia_path() -> Optional[str]:
    """Returns the join URL, or None if the UIA path failed for any reason."""
    log("attempting UIA primary path")
    app, win = _find_spotify_window()
    if win is None:
        log("Spotify window not found")
        return None

    try:
        win.set_focus()
    except Exception:
        pass

    # Step 1: open the Connect/devices flyout.
    connect_btn = _find_by_hint(win, CONNECT_BUTTON_HINTS)
    if connect_btn is None:
        log("connect button not found via UIA")
        return None
    if not _click(connect_btn):
        log("clicking connect button failed")
        return None
    time.sleep(0.6)

    # Step 2: click "Start a Jam".
    jam_btn = _find_by_hint(win, JAM_BUTTON_HINTS)
    if jam_btn is None:
        log("'Start a Jam' button not found via UIA")
        return None
    if not _click(jam_btn):
        log("clicking 'Start a Jam' failed")
        return None
    time.sleep(1.5)

    # Step 3: read share URL from the dialog, or copy + clipboard.
    url = _read_share_url_from_dialog(win)
    if url:
        return url

    url = _click_copy_link_and_read_clipboard(win)
    return url


# ---------------------------------------------------------------------------
# Vision fallback
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Vision coordinate cache
# ---------------------------------------------------------------------------
# Each successful vision-driven click is persisted next to the script so
# the next invocation can skip the OpenRouter round-trip (~1-3s + a paid
# API call). The cache is keyed by Spotify build version so a Spotify
# auto-update transparently invalidates stale entries; cached coords are
# tried first inside the vision-fallback path, and we still fall through
# to the LLM if the cached click misses.

_CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           ".jam_vision_cache.json")


def _load_vision_cache() -> dict:
    try:
        with open(_CACHE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def _save_vision_cache(cache: dict) -> None:
    try:
        tmp = _CACHE_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cache, f, indent=2)
        os.replace(tmp, _CACHE_PATH)
    except OSError as e:
        log(f"vision cache write failed: {e}")


def _spotify_version() -> str:
    """
    Return a string identifying the running Spotify build. We use the
    process's executable path + its file-modification time as a cheap
    proxy for "which Spotify version is this" — exact enough that an
    auto-update invalidates the cache without us needing to parse
    Spotify's own version metadata.
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


def _cache_key(version: str, label: str) -> str:
    return f"{version}::{label}"


def _try_cached_click(version: str, label: str) -> bool:
    cache = _load_vision_cache()
    entry = cache.get(_cache_key(version, label))
    if not entry:
        return False
    img, bbox = _grab_spotify_screenshot()
    if bbox is None:
        return False
    pct = (entry.get("x_pct"), entry.get("y_pct"))
    if not isinstance(pct[0], (int, float)) or not isinstance(pct[1], (int, float)):
        return False
    log(f"using cached vision coords for '{label}': {pct}")
    _click_at_window_pct(bbox, pct)
    return True


def _remember_click(version: str, label: str, pct: tuple[float, float]) -> None:
    cache = _load_vision_cache()
    cache[_cache_key(version, label)] = {
        "x_pct": pct[0],
        "y_pct": pct[1],
        "saved_at": int(time.time()),
    }
    _save_vision_cache(cache)


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


def _ask_vision_for_button(image, button_label: str) -> Optional[tuple[float, float]]:
    """Ask the OpenRouter vision model for the button center as percentages."""
    api_key = os.environ.get("OPENROUTER_API_KEY", "")
    if not api_key:
        log("OPENROUTER_API_KEY not set; skipping vision fallback")
        return None
    model = os.environ.get("OPENROUTER_MODEL_VISION", "openai/gpt-4o-mini")

    buf = io.BytesIO()
    image.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    prompt = (
        f"This is a screenshot of the Spotify desktop client window. "
        f"Find the '{button_label}' button. Reply with ONLY a JSON "
        f"object of the form {{\"x_pct\": <0-100>, \"y_pct\": <0-100>}} "
        f"giving the CENTER of the button as percentages of the image "
        f"width and height. If you cannot find it with high confidence, "
        f"reply with {{\"x_pct\": null, \"y_pct\": null}}."
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
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/png;base64,{b64}"
                                },
                            },
                        ],
                    }
                ],
                "max_tokens": 80,
            },
            timeout=20,
        )
        res.raise_for_status()
        msg = res.json()["choices"][0]["message"]["content"]
    except Exception as e:
        log(f"vision request failed: {e}")
        return None

    m = re.search(r"\{[^{}]*\}", msg)
    if not m:
        log(f"vision returned non-JSON: {msg[:120]}")
        return None
    try:
        coords = json.loads(m.group(0))
    except Exception:
        log(f"vision JSON parse failed: {msg[:120]}")
        return None
    x = coords.get("x_pct")
    y = coords.get("y_pct")
    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        log(f"vision returned null/invalid coords: {coords}")
        return None
    return (float(x), float(y))


def _click_at_window_pct(bbox: tuple[int, int, int, int], pct: tuple[float, float]) -> None:
    pyautogui = _import_pyautogui()
    left, top, w, h = bbox
    ax = int(left + (pct[0] / 100.0) * w)
    ay = int(top + (pct[1] / 100.0) * h)
    log(f"vision click at desktop ({ax},{ay})")
    pyautogui.moveTo(ax, ay, duration=0.15)
    pyautogui.click()


def try_vision_path() -> Optional[str]:
    log("attempting vision fallback path")
    version = _spotify_version()

    # Click sequence: Connect button, then Start a Jam. Try cached
    # coordinates first (per Spotify build); only call OpenRouter when
    # the cache misses or the cached click fails.
    for label in ("Connect to a device (speakers icon)", "Start a Jam"):
        if _try_cached_click(version, label):
            time.sleep(1.2)
            continue

        img, bbox = _grab_spotify_screenshot()
        if img is None:
            log("no Spotify window for screenshot")
            return None
        coords = _ask_vision_for_button(img, label)
        if coords is None:
            log(f"vision could not locate '{label}'")
            return None
        _click_at_window_pct(bbox, coords)
        _remember_click(version, label, coords)
        time.sleep(1.2)

    # After clicking Start a Jam, try to read the URL via UIA — the dialog
    # is a real OS-level dialog, so its text is usually exposed even when
    # the surrounding chrome wasn't.
    _, win = _find_spotify_window()
    if win is not None:
        url = _read_share_url_from_dialog(win)
        if url:
            return url
        url = _click_copy_link_and_read_clipboard(win)
        if url:
            return url

    return None


# ---------------------------------------------------------------------------
# Debug helpers
# ---------------------------------------------------------------------------

def dump_tree() -> None:
    """For debugging: print the UIA tree of the Spotify window to stderr."""
    _, win = _find_spotify_window()
    if win is None:
        log("Spotify window not found")
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

def run(vision_only: bool = False) -> None:
    if sys.platform != "win32":
        emit(
            {
                "ok": False,
                "reason": (
                    "jam_start_windows.py requires Windows. For the future "
                    "Linux port, see HOST_SETUP_WINDOWS.md."
                ),
            }
        )

    url: Optional[str] = None
    if not vision_only:
        try:
            url = try_uia_path()
        except Exception as e:
            log(f"UIA path raised: {e!r}")

    if url is None:
        try:
            url = try_vision_path()
        except Exception as e:
            log(f"vision path raised: {e!r}")

    if url is None:
        emit(
            {
                "ok": False,
                "reason": (
                    "Could not start a Jam. Check that the Spotify desktop "
                    "client is running and signed in, that no modal dialog is "
                    "blocking it, and that something is currently playing "
                    "(Spotify only allows starting a Jam from an active "
                    "playback context). Re-run with --debug-tree to inspect "
                    "the UIA control tree."
                ),
            }
        )

    emit({"ok": True, "joinUrl": url})


def main() -> None:
    parser = argparse.ArgumentParser(description="Drive Spotify Desktop to start a Jam.")
    parser.add_argument("--debug-tree", action="store_true",
                        help="Print Spotify's UIA tree to stderr and exit.")
    parser.add_argument("--vision-only", action="store_true",
                        help="Skip the UIA path; force vision fallback.")
    args = parser.parse_args()

    if args.debug_tree:
        dump_tree()
    else:
        run(vision_only=args.vision_only)


if __name__ == "__main__":
    main()
