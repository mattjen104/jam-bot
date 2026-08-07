#!/usr/bin/env bash
# Merge-gate wrapper for the crossing-tone autoplay-policy browser test.
#
# The interstitialTone spec pins two things that jsdom cannot see:
#  - strict autoplay policy still blocks a fresh Audio() with no gesture
#  - PlayerProvider's pre-unlocked tone element still plays >5s after the
#    gesture (the fix for the silent-skip corner)
#
# This wrapper exists so the gate FAILS LOUDLY (never skips) when its two
# environmental preconditions are missing:
#  1. a Chromium binary (system Chromium; no downloaded Playwright browsers)
#  2. the lore dev server (the spec loads /lore/ and the bundled tone asset)
set -euo pipefail

cd "$(dirname "$0")/.."

# --- 1. Resolve Chromium ----------------------------------------------------
if [[ -z "${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-}" ]]; then
  for candidate in chromium chromium-browser google-chrome; do
    if resolved="$(command -v "$candidate" 2>/dev/null)"; then
      export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$resolved"
      break
    fi
  done
fi
if [[ -z "${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-}" ]]; then
  echo "FAIL: no Chromium executable found." >&2
  echo "Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH or install system Chromium." >&2
  exit 1
fi
if [[ ! -x "$PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH" ]]; then
  echo "FAIL: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH is not executable: $PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH" >&2
  exit 1
fi
echo "Using Chromium: $PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"

# --- 2. Verify the lore dev server, or fall back to a self-started one ------
# If the running dev server (workflow 'artifacts/lore: web') is reachable we
# use it. Otherwise the gate stays self-contained: Playwright's webServer
# option starts a dedicated vite instance on TONE_GATE_PORT (which does not
# collide with the workflow's PORT). Real errors (Chromium missing, spec
# failure, vite failing to boot) still fail loudly.
BASE_URL="${PLAYWRIGHT_BASE_URL:-http://localhost:80}"
APP_URL="${BASE_URL%/}/lore/"
TONE_URL="${BASE_URL%/}/lore/src/assets/interstitial-tone.wav"

url_ok() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$1" || echo 000)"
  [[ "$code" == "200" ]]
}

free_port() {
  # Ask the kernel for a free ephemeral port (collision-safe across
  # parallel gate runs, unlike a fixed dedicated port).
  node -e 'const s=require("net").createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})'
}

# --- 3. Run the spec ---------------------------------------------------------
if url_ok "$APP_URL" && url_ok "$TONE_URL"; then
  echo "Dev server OK at $APP_URL"
  exec pnpm exec playwright test --config playwright.config.ts e2e/interstitialTone.spec.ts
fi

echo "Dev server not reachable at $APP_URL; starting a dedicated one."
# Ephemeral-port allocation has a tiny bind race with other processes, so
# retry with a fresh port if vite reports the port already in use. Any other
# failure (Chromium missing, spec failure, vite boot error) fails immediately.
for attempt in 1 2 3; do
  PLAYWRIGHT_WEB_SERVER_PORT="${TONE_GATE_PORT:-$(free_port)}"
  export PLAYWRIGHT_WEB_SERVER_PORT
  echo "Attempt $attempt: dedicated dev server on port $PLAYWRIGHT_WEB_SERVER_PORT"
  out_file="$(mktemp)"
  if pnpm exec playwright test --config playwright.config.ts e2e/interstitialTone.spec.ts 2>&1 | tee "$out_file"; then
    rm -f "$out_file"
    exit 0
  fi
  if grep -q "is already used" "$out_file" && [[ -z "${TONE_GATE_PORT:-}" ]]; then
    rm -f "$out_file"
    echo "Port $PLAYWRIGHT_WEB_SERVER_PORT was taken; retrying on a fresh port." >&2
    continue
  fi
  rm -f "$out_file"
  exit 1
done
echo "FAIL: could not find a free port for the dedicated dev server after 3 attempts." >&2
exit 1
