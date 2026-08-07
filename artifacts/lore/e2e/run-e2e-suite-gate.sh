#!/usr/bin/env bash
# Merge-gate wrapper for the rest of the Lore browser (Playwright) suite.
#
# Companion to run-interstitial-tone-gate.sh (the `tone-e2e` validation step),
# which owns e2e/interstitialTone.spec.ts. This gate runs the remaining specs
# that are reliable against the dev server: they intercept all API routes, so
# they carry no live-data dependence.
#
# Included specs:
#   - importPickerEntryPoints.spec.ts  (service-picker modal, all 4 entry points)
#   - spotifyConnectCallback.spec.ts   (?library=connected callback + /taste-map redirect)
#
# Explicitly EXCLUDED specs (kept in e2e/ for reference / future repair):
#   - fallbackNotice.spec.ts        — discovers run IDs from LIVE spin data for a
#                                     pinned MBID/picker handle; the anchors have
#                                     drifted out of the dev DB (spin-replay-0 no
#                                     longer renders), so it is live-data flaky.
#   - libraryPromptVisibility.spec.ts and spotifyConnectButton.spec.ts
#                                   — both target data-testid="library-prompt",
#                                     a banner that no longer exists (the connect
#                                     surface moved into the Library page, covered
#                                     by importPickerEntryPoints).
#   - librarySyncLifecycle.spec.ts  — targets library-sync / library-sync-receipt /
#                                     library-sync-button testids removed in the
#                                     Library dial-style redesign (only
#                                     library-sync-receipt-toggle survives).
#   - linerNotesSheet.spec.ts       — tests RecordPeekNav, which is currently
#                                     hidden (not rendered) in App.tsx.
#   - ntsOnAirBadge.spec.ts         — clicks station-<slug> cards from StationList,
#                                     which is no longer mounted anywhere (front
#                                     door is the dial hero now).
#
# Like the tone gate, this wrapper FAILS LOUDLY (never skips) when its
# environmental preconditions are missing:
#  1. a Chromium binary (system Chromium; no downloaded Playwright browsers)
#  2. the lore dev server (specs load /lore/ pages)
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

code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$APP_URL" || echo 000)"
if [[ "$code" != "200" ]]; then
  echo "FAIL: lore dev server not reachable ($APP_URL -> HTTP $code)." >&2
  echo "Start the lore dev server (workflow 'artifacts/lore: web') before running this gate." >&2
  exit 1
fi
echo "Dev server OK at $APP_URL"

# --- 3. Run the reliable specs ------------------------------------------------
exec pnpm exec playwright test --config playwright.config.ts \
  e2e/importPickerEntryPoints.spec.ts \
  e2e/spotifyConnectCallback.spec.ts
