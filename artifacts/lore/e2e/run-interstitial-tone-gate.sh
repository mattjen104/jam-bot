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

# --- 2. Verify the lore dev server is up ------------------------------------
BASE_URL="${PLAYWRIGHT_BASE_URL:-http://localhost:80}"
APP_URL="${BASE_URL%/}/lore/"
TONE_URL="${BASE_URL%/}/lore/src/assets/interstitial-tone.wav"

check_url() {
  local url="$1" label="$2"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" || echo 000)"
  if [[ "$code" != "200" ]]; then
    echo "FAIL: $label not reachable ($url -> HTTP $code)." >&2
    echo "Start the lore dev server (workflow 'artifacts/lore: web') before running this gate." >&2
    exit 1
  fi
}
check_url "$APP_URL" "lore dev server"
check_url "$TONE_URL" "interstitial tone asset"
echo "Dev server OK at $APP_URL"

# --- 3. Run the spec ---------------------------------------------------------
exec pnpm exec playwright test --config playwright.config.ts e2e/interstitialTone.spec.ts
