#!/usr/bin/env bash
# Merge-gate wrapper for the rest of the Lore browser (Playwright) suite.
#
# Companion to run-interstitial-tone-gate.sh (the `tone-e2e` validation step),
# which owns e2e/interstitialTone.spec.ts. This gate runs the remaining specs
# that are reliable against the dev server: they intercept all API routes, so
# they carry no live-data dependence.
#
# Included specs:
#   - spotifyConnectCallback.spec.ts   (?library=connected callback + /taste-map redirect)
#   - librarySyncLifecycle.spec.ts     (direct Library sync lifecycle)
#   - fallbackNotice.spec.ts           (archive-run fallback notice; all API routes
#                                       intercepted with fixtures)
#   - cornerNavTappability.spec.ts     (mobile shell navigation and player dock)
#   - microDialRemote.spec.ts          (one-card Radio presets and selection-only
#                                       navigation at mobile + desktop viewport sizes)
#   - firstRunSidebarOnboarding.spec.ts (first-time visitor sees .frb__block sentences,
#                                       NOT .z1-placeholder__seedchip chips; data-rung
#                                       order non-decreasing)
#   - liveTrackChange.spec.ts          (SSE fast path: spin-raw provisional cue appears
#   - adminHealthRecovery.spec.ts      (authenticated admin recovery controls)
#   - rotatingScheduleDisplay.spec.ts  (dated alternatives remain complete while
#                                       recurring stations keep the weekly grid)
#   - spinitronDatedCalendarLink.spec.ts (no-key station runs retain the dated
#                                         public Spinitron calendar handoff)
#                                       immediately; spin-changed/spin-raw-failed clear it
#                                       on WebPlayer and Dial rows; rapid station switches
#                                       cannot let an old landing confirm PlayerDock)
# Specs for the retired multi-row Dial/compact-Stack shell are intentionally
# not in this gate:
#   - dialAgeFilter.spec.ts — retired Dial row feed and age-tier command surface
#   - dialInfiniteScroll.spec.ts — retired .fdrow/.ghost-row folds and sentinels
#   - stationAdminRemoval.spec.ts — retired .fdrow context menu
#   - importPickerEntryPoints.spec.ts — retired Library empty-state/stats/reconnect
#                                       import buttons
#
# Deleted specs (UI intentionally removed; no longer kept for reference):
#   - libraryPromptVisibility.spec.ts / spotifyConnectButton.spec.ts — targeted the
#     removed data-testid="library-prompt" banner; the connect surface moved into
#     the Library page and is covered by importPickerEntryPoints.spec.ts.
#   - linerNotesSheet.spec.ts — tested RecordPeekNav + the NowPlaying liner-notes
#     sheet; both are intentionally unmounted (section nav is SlimSectionNav, the
#     NowPlaying panel is no longer rendered).
#   - dialHeroQueueGeometry.spec.ts — tested the pinned-station set queue beside
#     the album art; the pinned overlay / set panel was intentionally removed
#     (station rows are now the only tuning interaction, no queue panel opens).
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

# --- 2. Verify the lore dev server, or fall back to a self-started one ------
# If the running dev server (workflow 'artifacts/lore: web') is reachable we
# use it. Otherwise this gate stays self-contained: Playwright's webServer
# option starts a dedicated vite instance on a free ephemeral port (which does
# not collide with the workflow's PORT). Real errors (Chromium missing, spec
# failure, vite failing to boot) still fail loudly.
BASE_URL="${PLAYWRIGHT_BASE_URL:-http://localhost:80}"
APP_URL="${BASE_URL%/}/lore/"

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

RUN_SPECS=(
  e2e/spotifyConnectCallback.spec.ts
  e2e/librarySyncLifecycle.spec.ts
  e2e/fallbackNotice.spec.ts
  e2e/cornerNavTappability.spec.ts
  e2e/microDialRemote.spec.ts
  e2e/firstRunSidebarOnboarding.spec.ts
  e2e/adminHealthRecovery.spec.ts
  e2e/rotatingScheduleDisplay.spec.ts
  e2e/spinitronDatedCalendarLink.spec.ts
  e2e/liveTrackChange.spec.ts
  e2e/unifiedScanSession.spec.ts
)

# --- 3. Run the reliable specs ------------------------------------------------
if url_ok "$APP_URL"; then
  echo "Dev server OK at $APP_URL"
  exec pnpm exec playwright test --config playwright.config.ts --project=chromium "${RUN_SPECS[@]}"
fi

echo "Dev server not reachable at $APP_URL; starting a dedicated one."
# Ephemeral-port allocation has a tiny bind race with other processes, so
# retry with a fresh port if vite reports the port already in use. Any other
# failure (Chromium missing, spec failure, vite boot error) fails immediately.
for attempt in 1 2 3; do
  PLAYWRIGHT_WEB_SERVER_PORT="${SUITE_GATE_PORT:-$(free_port)}"
  export PLAYWRIGHT_WEB_SERVER_PORT
  echo "Attempt $attempt: dedicated dev server on port $PLAYWRIGHT_WEB_SERVER_PORT"
  out_file="$(mktemp)"
  if pnpm exec playwright test --config playwright.config.ts --project=chromium "${RUN_SPECS[@]}" 2>&1 | tee "$out_file"; then
    rm -f "$out_file"
    exit 0
  fi
  if grep -q "is already used" "$out_file" && [[ -z "${SUITE_GATE_PORT:-}" ]]; then
    rm -f "$out_file"
    echo "Port $PLAYWRIGHT_WEB_SERVER_PORT was taken; retrying on a fresh port." >&2
    continue
  fi
  rm -f "$out_file"
  exit 1
done
echo "FAIL: could not find a free port for the dedicated dev server after 3 attempts." >&2
exit 1
