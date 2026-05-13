# Jam Host on Windows — Setup Guide

Make your always-on Windows PC the Jam Host: it runs Spotify Desktop,
the Python token relay, the Cloudflare tunnel, and the new UI-automation
driver that lets the Slack bot click *Start a Jam* in Spotify on your
behalf.

This replaces the old "droplet librespot is the host" architecture. The
droplet keeps running the Slack bot only.

---

## Why this exists

Spotify only lets the desktop, mobile, and web *clients* create Jams —
the public Web API has no `create-session` endpoint, and the Web Player
token (the one we already harvest with the Chrome extension) is
explicitly rejected by Spotify's internal create endpoint. The simplest
reliable workaround is to drive a real Spotify Desktop client by
clicking the actual UI buttons — pywinauto for the happy path, a vision
LLM for when Spotify's accessibility tree goes sparse.

---

## Prerequisites

- Windows 10 or 11.
- A Spotify Premium account signed into Spotify Desktop, with
  *something currently playing* before each `start a jam` (Spotify
  refuses to create a Jam from an idle context).
- Python 3.11+ on `PATH` (`python --version` from PowerShell).
- Chrome / Edge / Brave with the Jam Token Relay extension installed
  (see `chrome-extension/README.md`) and a Spotify Web Player tab
  signed in as the same Premium account.
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
  on `PATH`.

---

## Install Python deps

In PowerShell, in this directory:

```powershell
python -m pip install --upgrade pip
python -m pip install pywinauto pyautogui mss Pillow requests psutil websocket-client
```

`psutil` is optional but makes Spotify-window detection more reliable
when several "Spotify-titled" notification popups exist.
`websocket-client` is required for the CDP (DOM) substrate; without it
the driver falls back to UIA + vision only.

---

## Enable Spotify's debug port (CDP / DOM substrate)

Spotify Desktop is an Electron app. Launched with
`--remote-debugging-port=9222` it exposes a real Chromium DevTools
endpoint, which lets the driver address buttons by `aria-label`,
`data-testid`, and visible text — far more reliable than the UI
Automation tree, which Spotify rebuilds frequently.

This is **strongly recommended** but optional: without it the driver
falls back to UIA + vision and still works.

1. Find your Spotify shortcut (Start Menu → right-click "Spotify" →
   *More* → *Open file location*; or your taskbar/desktop shortcut).
2. Right-click the shortcut → *Properties*.
3. In the *Target* field, append a space and **both** of these flags to
   the existing path:
   `--remote-debugging-port=9222 --remote-allow-origins=*`
   Example:
   `"C:\Users\<you>\AppData\Roaming\Spotify\Spotify.exe" --remote-debugging-port=9222 --remote-allow-origins=*`

   The second flag is required on recent Chromium versions, otherwise
   the DevTools websocket handshake returns **403 Forbidden** ("Rejected
   an incoming WebSocket connection from the http://127.0.0.1:9222
   origin") and the CDP substrate is silently disabled.
4. Click *Apply*. Fully quit Spotify (right-click tray icon → Quit), then
   relaunch from the modified shortcut.

Verify it's listening:

```powershell
curl http://localhost:9222/json
```

You should get back a JSON array including a `"type": "page"` target
with a Spotify URL. If you instead get "connection refused", Spotify
either wasn't relaunched from the modified shortcut or another instance
(autostarted at boot) is still running without the flag — fully quit
all Spotify processes (Task Manager → Spotify.exe) and relaunch from
the shortcut.

The driver auto-detects the CDP endpoint on every run; once it's
working, you'll see `[jam-driver] step substrate=cdp goal=... result=ok`
in the relay log instead of the slower UIA path.

---

## Configure environment

In the terminal that will run the relay:

```powershell
$env:RELAY_SECRET   = "paste-the-same-64-char-hex-as-the-droplet-and-extension"
$env:OPENROUTER_API_KEY = "sk-or-..."   # only needed for vision fallback
# Optional: pin the vision model. Default is openai/gpt-4o-mini.
# $env:OPENROUTER_MODEL_VISION = "openai/gpt-4o-mini"
```

The relay automatically passes `OPENROUTER_API_KEY` through to the UI
driver subprocess. Without it, the UIA primary path still works — only
the vision fallback is disabled.

---

## Launch the three processes

You need three things running concurrently. Each in its own terminal:

```powershell
# Terminal 1 — Spotify Desktop
# Just launch it normally and sign in as the Jam Host. Play any track
# briefly so it has an active playback context.

# Terminal 2 — the relay
cd path\to\jam-bot\tools\spotify-token-relay
python jam_relay.py

# Terminal 3 — the Cloudflare tunnel
cloudflared tunnel --url http://localhost:8787
```

Copy the `https://*.trycloudflare.com` URL cloudflared prints — that's
the value of `SPOTIFY_TOKEN_RELAY_URL` on the droplet *and* in the
Chrome extension's options page. (Quick-tunnel URLs rotate every
restart, so update both places when you bounce cloudflared.)

---

## Verify end-to-end

From the **droplet** (or any other machine that has the secret):

```bash
# 1. Token endpoint should serve a fresh token from the extension.
curl -s -H "Authorization: Bearer $RELAY_SECRET" \
  "$RELAY_URL/token" | jq .isAnonymous
# -> false

# 2. Drive the UI to start a Jam.
curl -s -X POST -H "Authorization: Bearer $RELAY_SECRET" \
  "$RELAY_URL/jam/start" | jq .
# -> { "ok": true, "joinUrl": "https://open.spotify.com/jam/..." }
```

If `/jam/start` returns `ok:false`, the `reason` field tells you what
went wrong (Spotify window not found, button not found, driver timeout,
etc). On the host machine, the relay prints `[driver] ...` lines with
the UI driver's stderr tail so you can see what it tried.

You can also run the driver directly for debugging:

```powershell
# Dump Spotify's UIA control tree (useful when buttons can't be found)
python jam_start_windows.py --debug-tree

# Skip the UIA path entirely and force the vision fallback
python jam_start_windows.py --vision-only
```

---

## Make it survive a reboot

You have two reasonable options. The simpler one:

### Option A — Task Scheduler

Create three Scheduled Tasks, all triggered "At log on of <your user>":

1. **Spotify Desktop** — Action: `start "" "%APPDATA%\Spotify\Spotify.exe"`.
2. **Jam relay** — Action: `powershell.exe -WindowStyle Minimized -Command
   "$env:RELAY_SECRET='...'; $env:OPENROUTER_API_KEY='...'; cd
   C:\path\to\jam-bot\tools\spotify-token-relay; python jam_relay.py"`.
3. **cloudflared tunnel** — Action: `cloudflared.exe tunnel --url
   http://localhost:8787`.

Set each task's "Start in" field to the relay directory and tick "Run
only when user is logged on." (UI automation requires a real
interactive session — the driver cannot click anything from the
LocalSystem account.)

### Option B — NSSM (run as a service)

NSSM-installed services that drive the UI must run with **"Allow service
to interact with desktop"** *and* the user must stay logged in.
Generally Option A is less fiddly.

---

## Things that will break it

- **Spotify auto-update changes the UI.** Spotify ships frequent
  client updates that occasionally rename or move the Connect / Jam
  buttons. The vision fallback handles most of these silently. If both
  paths fail, run `python jam_start_windows.py --debug-tree` and
  search the dump for the new button name; add it to the `*_HINTS`
  tuples at the top of `jam_start_windows.py`.
- **Screen lock / RDP disconnect.** UIA cannot drive a locked desktop.
  Configure Windows to never lock the screen on this machine, and if
  you connect via RDP, *do not* close the RDP session with the lock —
  use `tscon` to reattach the console session, or just leave the
  machine signed in.
- **Multi-monitor / DPI scaling.** The driver uses window-relative
  coordinates from UIA's `rectangle()`, so multi-monitor setups work
  out of the box. If you change DPI scaling, log out and back in so
  pywinauto re-reads the values.
- **Spotify is idle.** Spotify only lets you start a Jam from an
  active playback context. Make sure something is playing before
  triggering `start a jam` from Slack. The bot will surface
  "Spotify rejected the create" if you forget.
- **Two Slack triggers at once.** The relay serialises driver runs
  with a process-wide lock; the second caller gets an "already in
  flight" response within 2 seconds rather than racing the UI.

---

## Future Linux port (deferred)

When the Jam Host eventually moves to a Linux box (e.g. an old Mac
running a Linux distro), the only piece that needs a port is
`jam_start_windows.py`. The relay already invokes a hard-coded driver
path, but the swap is straightforward:

1. Add `jam_start_linux.py` next to the Windows driver, exposing the
   same stdin/stdout JSON contract: write a single
   `{"ok": ..., "joinUrl": ..., "reason": ...}` object to stdout, all
   logging to stderr, exit 0.
2. Implement the click sequence with **AT-SPI** (`pyatspi`) for the
   primary path and `xdotool` / `wmctrl` (or the same vision fallback)
   for clicks. Spotify on Linux exposes a slightly more complete
   accessibility tree than on Windows, so the UIA-equivalent path is
   often easier.
3. In `jam_relay.py`, change the `JAM_DRIVER_PATH` selection to
   pick `jam_start_linux.py` on `sys.platform != "win32"`.

The bot side and the relay HTTP contract do not change.
